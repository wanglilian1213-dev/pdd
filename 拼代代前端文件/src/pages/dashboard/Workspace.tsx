import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { UploadCloud, FileText, CheckCircle2, ChevronRight, AlertCircle, Download, Bot, ShieldCheck, RefreshCw, X, Loader2, File } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function Workspace() {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<string[]>([]);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isReducing, setIsReducing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((f: File) => f.name);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleGenerateOutline = () => {
    setIsGeneratingOutline(true);
    setTimeout(() => {
      setIsGeneratingOutline(false);
      setStep(2);
    }, 2000);
  };

  const handleGenerateContent = () => {
    setStep(3);
    setTimeout(() => setStep(4), 2000);
    setTimeout(() => setStep(5), 4000);
    setTimeout(() => setStep(6), 6000);
  };

  const handleReduceAI = () => {
    setStep(7);
    setIsReducing(true);
    setTimeout(() => setIsReducing(false), 3000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">智能写作工作台</h1>
          <p className="text-sm text-gray-500 mt-1">上传任务材料，系统将为您自动生成高质量文章。</p>
        </div>
        <div className="flex items-center justify-between sm:justify-start gap-2 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm w-full sm:w-auto">
          <span className="text-sm text-gray-500">当前积分:</span>
          <span className="text-lg font-bold text-red-700">12,500</span>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between min-w-[700px]">
          {[
            { num: 1, label: '上传分析', active: step >= 1 },
            { num: 2, label: '确认大纲', active: step >= 2 },
            { num: 3, label: '正文生成', active: step >= 3 },
            { num: 4, label: '字数矫正', active: step >= 4 },
            { num: 5, label: '引用核验', active: step >= 5 },
            { num: 6, label: '交付核验', active: step >= 6 },
            { num: 7, label: '降低AI', active: step >= 7 },
          ].map((s, i) => (
            <div key={i} className="flex flex-col items-center flex-1 relative">
              <div className={`
                w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm z-10 transition-colors
                ${s.active ? 'bg-red-700 text-white shadow-md' : 'bg-gray-100 text-gray-400'}
              `}>
                {s.active && step > s.num ? <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" /> : s.num}
              </div>
              <span className={`text-xs mt-2 font-medium whitespace-nowrap ${s.active ? 'text-gray-900' : 'text-gray-400'}`}>
                {s.label}
              </span>
              {i < 6 && (
                <div className={`absolute top-4 sm:top-5 left-1/2 w-full h-0.5 -translate-y-1/2 ${step > i + 1 ? 'bg-red-700' : 'bg-gray-100'}`}></div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle>上传任务材料</CardTitle>
              <CardDescription>支持 txt, md, docx, pdf, ppt, pptx 格式。可上传多个文件。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div 
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:bg-gray-50 hover:border-red-300 transition-all cursor-pointer group relative"
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  multiple 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".txt,.md,.docx,.pdf,.ppt,.pptx"
                />
                <div className="w-16 h-16 mx-auto bg-red-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <UploadCloud className="w-8 h-8 text-red-700" />
                </div>
                <p className="text-base font-medium text-gray-900 mb-1">点击或拖拽文件到此处上传</p>
                <p className="text-sm text-gray-500">单文件不超过 20MB，最多支持 10 个文件</p>
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-900">已上传文件 ({files.length})</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <File className="w-5 h-5 text-red-600 flex-shrink-0" />
                          <span className="text-sm text-gray-700 truncate">{file}</span>
                        </div>
                        <button onClick={() => removeFile(index)} className="text-gray-400 hover:text-red-600 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">特殊要求补充（选填）</label>
                <textarea 
                  className="w-full h-32 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-700 focus:border-transparent resize-none"
                  placeholder="例如：请使用 APA 7th 引用格式，字数控制在 2000 字左右，重点分析第三个案例..."
                ></textarea>
              </div>

              <div className="flex justify-end">
                <Button 
                  onClick={handleGenerateOutline} 
                  className="px-8 shadow-sm"
                  disabled={isGeneratingOutline || files.length === 0}
                >
                  {isGeneratingOutline ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" /> 正在解析要求...
                    </>
                  ) : (
                    <>
                      开始分析并生成大纲 <ChevronRight className="ml-2 w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Step 2: Outline */}
      {step === 2 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row justify-between items-start">
              <div>
                <CardTitle className="text-xl text-red-700 flex items-center gap-2">
                  <FileText className="w-5 h-5" /> 英文大纲已生成
                </CardTitle>
                <CardDescription className="mt-2">
                  请仔细检查大纲结构。确认无误后，系统将基于此大纲生成完整正文。
                </CardDescription>
              </div>
              <div className="text-right text-sm">
                <div className="text-gray-500">目标字数: <span className="font-medium text-gray-900">2,000 words</span></div>
                <div className="text-gray-500">引用格式: <span className="font-medium text-gray-900">APA 7th</span></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 font-mono text-sm leading-relaxed text-gray-800">
                <h3 className="font-bold text-lg mb-4">Title: The Impact of Artificial Intelligence on Modern Supply Chain Management</h3>
                
                <div className="space-y-4">
                  <div>
                    <p className="font-bold">I. Introduction (approx. 200 words)</p>
                    <ul className="list-disc list-inside ml-4 text-gray-600">
                      <li>Background on traditional supply chain challenges.</li>
                      <li>Definition and scope of AI in this context.</li>
                      <li>Thesis statement: AI significantly enhances efficiency, predictability, and resilience in modern supply chains.</li>
                    </ul>
                  </div>
                  
                  <div>
                    <p className="font-bold">II. Predictive Analytics and Demand Forecasting (approx. 500 words)</p>
                    <ul className="list-disc list-inside ml-4 text-gray-600">
                      <li>Transition from historical data to real-time predictive models.</li>
                      <li>Case study/example of inventory optimization.</li>
                      <li>Reduction of the bullwhip effect.</li>
                    </ul>
                  </div>
                  
                  <div>
                    <p className="font-bold">III. Automation in Warehousing and Logistics (approx. 500 words)</p>
                    <ul className="list-disc list-inside ml-4 text-gray-600">
                      <li>Role of robotics and automated guided vehicles (AGVs).</li>
                      <li>AI-driven route optimization for delivery (e.g., traveling salesman problem solutions).</li>
                      <li>Cost reduction and speed improvement metrics.</li>
                    </ul>
                  </div>
                  
                  <div>
                    <p className="font-bold">IV. Risk Management and Resilience (approx. 500 words)</p>
                    <ul className="list-disc list-inside ml-4 text-gray-600">
                      <li>Identifying potential disruptions (weather, geopolitical, supplier failure) using AI.</li>
                      <li>Dynamic rerouting and supplier switching.</li>
                      <li>Building a proactive rather than reactive supply chain.</li>
                    </ul>
                  </div>
                  
                  <div>
                    <p className="font-bold">V. Conclusion (approx. 300 words)</p>
                    <ul className="list-disc list-inside ml-4 text-gray-600">
                      <li>Summary of main points.</li>
                      <li>Future outlook: The integration of AI with IoT and blockchain.</li>
                      <li>Final thought on the necessity of AI adoption for competitive advantage.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">对大纲有修改意见？（选填）</label>
                <textarea 
                  className="w-full h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-700 focus:border-transparent resize-none"
                  placeholder="例如：请在第三部分增加关于无人机配送的讨论..."
                ></textarea>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-gray-100 gap-4">
                <Button variant="outline" onClick={() => setStep(1)} className="w-full sm:w-auto">返回修改要求</Button>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <Button variant="secondary" className="bg-gray-100 text-gray-700 hover:bg-gray-200 w-full sm:w-auto">重新生成大纲</Button>
                  <Button onClick={handleGenerateContent} className="shadow-sm w-full sm:w-auto">
                    确认大纲，开始生成
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Steps 3, 4, 5: Processing */}
      {step >= 3 && step <= 5 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-16 flex flex-col items-center justify-center space-y-6">
              <Loader2 className="w-16 h-16 text-red-700 animate-spin" />
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-gray-900">
                  {step === 3 && '正在生成正文...'}
                  {step === 4 && '正在进行字数矫正...'}
                  {step === 5 && '正在进行引用核验...'}
                </h3>
                <p className="text-gray-500">请耐心等待，系统正在调用 Academic-RLHF™ 引擎处理中</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Step 6: Delivery */}
      {step === 6 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm border-t-4 border-t-emerald-500">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-emerald-100 p-2 rounded-full">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <CardTitle className="text-2xl">交付核验完成</CardTitle>
              </div>
              <CardDescription>您的文章已生成完毕，并已通过引用核验。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Final Document */}
                <div className="border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center hover:border-red-300 transition-colors bg-white shadow-sm">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">最终版文章</h3>
                  <p className="text-xs text-gray-500 mb-6">Word 格式 (.docx) • 2,145 words</p>
                  <Button className="w-full gap-2" variant="outline">
                    <Download className="w-4 h-4" /> 下载文档
                  </Button>
                </div>

                {/* Verification Report */}
                <div className="border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center hover:border-red-300 transition-colors bg-white shadow-sm">
                  <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-4">
                    <ShieldCheck className="w-8 h-8" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">引用核验报告</h3>
                  <p className="text-xs text-gray-500 mb-6">PDF 格式 (.pdf) • 包含 12 处真实引用</p>
                  <Button className="w-full gap-2" variant="outline">
                    <Download className="w-4 h-4" /> 下载报告
                  </Button>
                </div>
              </div>

              {/* AI Reduction Section */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <Bot className="w-5 h-5 text-red-700" /> 觉得 AI 痕迹过重？
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  您可以使用自动降AI功能，系统将重写部分文本结构以降低检测率。
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button className="flex-1 gap-2 shadow-sm" onClick={handleReduceAI}>
                    <RefreshCw className="w-4 h-4" /> 开始自动降AI
                  </Button>
                  <Button variant="secondary" className="flex-1 gap-2 bg-white border border-gray-200">
                    人工降AI请联系客服
                  </Button>
                </div>
              </div>

              <div className="flex justify-center pt-4">
                <Button variant="link" onClick={() => { setStep(1); setFiles([]); }} className="text-gray-500 hover:text-gray-900">
                  创建新任务
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Step 7: Reduce AI */}
      {step === 7 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-gray-200 shadow-sm border-t-4 border-t-blue-500">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-blue-100 p-2 rounded-full">
                  <Bot className="w-6 h-6 text-blue-600" />
                </div>
                <CardTitle className="text-2xl">AI 降重处理</CardTitle>
              </div>
              <CardDescription>系统正在使用对抗网络降低文本的 AI 生成特征。</CardDescription>
            </CardHeader>
            <CardContent>
              {isReducing ? (
                <div className="p-12 flex flex-col items-center justify-center space-y-6">
                  <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold text-gray-900">正在进行深度 AI 降重...</h3>
                    <p className="text-gray-500">预计需要 1-2 分钟，请勿关闭页面</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 animate-in fade-in zoom-in duration-500">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3 text-emerald-800">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    <div>
                      <p className="font-bold">降重完成！</p>
                      <p className="text-sm">AI 特征已显著降低，请下载最新版本。</p>
                    </div>
                  </div>
                  
                  <div className="border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center hover:border-blue-300 transition-colors bg-white shadow-sm max-w-md mx-auto">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                      <FileText className="w-8 h-8" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">降重版文章</h3>
                    <p className="text-xs text-gray-500 mb-6">Word 格式 (.docx) • 2,150 words</p>
                    <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                      <Download className="w-4 h-4" /> 下载降重版
                    </Button>
                  </div>

                  <div className="flex justify-center pt-4 border-t border-gray-100">
                    <Button variant="link" onClick={() => { setStep(1); setFiles([]); }} className="text-gray-500 hover:text-gray-900">
                      完成并创建新任务
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
