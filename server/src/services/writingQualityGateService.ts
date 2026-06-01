import type { RenderedChart } from './chartRenderService';
import { extractBodyHeadingLines } from './documentFormattingService';
import type { StoredMaterialFile } from './materialInputService';
import { assessGeneratedPaper, summarizeReferenceCompliance } from './paperQualityService';
import type { StructuredDataAnalysisResult } from './structuredDataAnalysisService';

export type ProfessionalParameterAction =
  | 'not_required'
  | 'web_lookup_first'
  | 'high_level_schematic';

export interface ProfessionalParameterHandling {
  action: ProfessionalParameterAction;
  reasons: string[];
}

export interface WritingQualityRequirementProfile {
  requiresVisual: boolean;
  requiresDataAnalysis: boolean;
  requiresRubricReview: boolean;
  requiresProfessionalParameters: boolean;
  requiresTable: boolean;
  prohibitsVisuals: boolean;
  prohibitsBulletLists: boolean;
  prohibitsFirstPerson: boolean;
  externalSourcesAllowed: boolean;
  requiredVisualCount: number;
  maximumVisualCount?: number;
  requiredDocumentElements: RequiredDocumentElement[];
  requiredBodyHeadings: string[];
  minimumReferenceYear?: number;
  requiresPeerReviewedReferences: boolean;
  chartRequirement?: ChartRequirement;
  dataScope?: DataScopeRequirement;
  unsupportedDataOperations: string[];
  parameterHandling: ProfessionalParameterHandling;
  signals: string[];
}

export type RequiredDocumentElement =
  | 'introduction'
  | 'abstract'
  | 'table_of_contents'
  | 'appendix'
  | 'executive_summary'
  | 'policy_options'
  | 'recommendation'
  | 'literature_review'
  | 'methodology'
  | 'results'
  | 'discussion'
  | 'conclusion';

export type ChartRequirementType = 'scatter' | 'line' | 'bar' | 'pie' | 'histogram' | 'boxplot' | 'errorbar' | 'dual_axis';

export interface ChartRequirement {
  chartType?: ChartRequirementType;
  chartTypes?: ChartRequirementType[];
  xAxis?: string;
  yAxis?: string;
  requiresDiagram?: boolean;
}

export interface DataScopeRequirement {
  requiredSheetNames: string[];
  requiredColumnNames: string[];
  requiredGroupNames: string[];
  dateRange?: {
    label: string;
    start: string;
    end: string;
  };
}

export interface WritingQualityRequirementInput {
  specialRequirements?: string | null;
  outline?: string | null;
  materialFiles?: StoredMaterialFile[];
}

export interface FinalAcademicDeliveryInput {
  finalText: string;
  chartText: string;
  mediaMap: Map<string, RenderedChart>;
  profile: WritingQualityRequirementProfile;
  dataAnalysis: StructuredDataAnalysisResult;
  requiredReferenceCount: number;
  citationStyle: string;
  targetWords?: number;
  requiredSectionCount?: number;
}

const VISUAL_RE = /\b(chart|charts|graph|graphs|figure|figures|diagram|diagrams|flowchart|flowcharts|visual|visualisation|visualization|plot|plots|draw|illustrate)\b|图表|图示|示意图|流程图|曲线图|柱状图|折线图|画图/i;
const DOCUMENT_ELEMENT_RE = /\b(?:introduction|abstract|table of contents|contents page|appendix|appendices|executive summary|literature review|methodology|methods?|results?|discussion|conclusion)\b|摘要|目录|附录|执行摘要|引言|导论|文献综述|方法论|研究方法|结果|讨论|结论/i;
const TABLE_RE = /\b(?:comparison|summary|data|results?|evidence|descriptive)?\s*table\b|表格|对比表|数据表|结果表/i;
const TABLE_OF_CONTENTS_RE = /\btable of contents\b|目录/i;
const PROHIBIT_VISUAL_RE = /\b(?:do\s+not|don't|dont|must\s+not|should\s+not|no|without|avoid|exclude)\s+(?:include|use|add|create|draw|provide)?\s*(?:any\s+)?(?:charts?|graphs?|figures?|diagrams?|flowcharts?|visuals?|plots?)\b|不要(?:包含|使用|添加|画)?(?:任何)?(?:图表|图示|示意图|流程图|图片)|不(?:需要|要|允许)(?:任何)?(?:图表|图示|示意图|流程图|图片)|禁止(?:图表|图示|示意图|流程图|图片)/i;
const PROHIBIT_BULLET_LIST_RE = /\b(?:no|without|avoid|exclude)\s+(?:bullet points?|bulleted lists?|numbered lists?)\b|\b(?:do\s+not|don't|dont|must\s+not|should\s+not)\s+(?:use|include|write)\s+(?:bullet points?|bulleted lists?|numbered lists?)\b|\bfull academic paragraphs only\b|不要(?:使用|写)?(?:项目符号|列表|编号列表)|禁止(?:项目符号|列表|编号列表)|只写(?:完整)?段落/i;
const PROHIBIT_FIRST_PERSON_RE = /\b(?:third person only|write in third person|avoid first person|no first person|without first person|do not use first person|don't use first person|must not use first person|avoid personal pronouns|no personal pronouns)\b|第三人称|不要(?:使用)?第一人称|禁止第一人称|避免第一人称|不要(?:用)?我(?:们)?|禁止(?:用)?我(?:们)?/i;
const DATA_ANALYSIS_RE = /\b(data analysis|statistical analysis|analyse data|analyze data|analyse the data|analyze the data|dataset|data set|csv|tsv|spreadsheet|excel|workbook|json data|regression|correlation|anova|t-test|chi-square)\b|数据分析|数据集|统计分析|回归|相关分析/i;
const DATA_ANALYSIS_INTENT_RE = /\b(data analysis|statistical analysis|analyse data|analyze data|analyse the data|analyze the data)\b|数据分析|统计分析/i;
const DATA_FILE_CONTEXT_RE = /\b(dataset|data set|csv|tsv|spreadsheet|excel|workbook|json data)\b|数据集|数据文件|电子表格|工作簿/i;
const UPLOADED_DATA_CONTEXT_RE = /\b(?:uploaded|provided|attached|source|raw)\b[^.。！？\n]{0,80}\b(?:data|dataset|data set|csv|tsv|spreadsheet|excel|workbook|json)\b|\b(?:data|dataset|data set|csv|tsv|spreadsheet|excel|workbook|json)\b[^.。！？\n]{0,80}\b(?:uploaded|provided|attached|file|files)\b|(?:上传|提供|附加|附件)[^。！？\n]{0,80}(?:数据|数据集|数据文件|表格|电子表格|Excel|CSV)|(?:数据|数据集|数据文件|表格|电子表格|Excel|CSV)[^。！？\n]{0,80}(?:上传|提供|附件|文件)/i;
const DATA_METHOD_REQUEST_RE = /\b(?:run|perform|conduct|carry out|calculate|compute|test|estimate|model|analyse|analyze)\b[^.。！？\n]{0,100}\b(?:regression|correlation|anova|t-test|chi-square)\b|\b(?:regression|correlation|anova|t-test|chi-square)\b[^.。！？\n]{0,100}\b(?:analysis|test|model)\b|(?:回归|相关分析)[^。！？\n]{0,60}(?:分析|模型|检验)/i;
const PIVOT_OPERATION_RE = /\b(?:pivot\s+table|pivot\s+chart|crosstab|cross-?tab|cross\s+tabulation)\b|数据透视表|透视表|交叉表/i;
const JOIN_OPERATION_RE = /\b(?:join|merge|match|link|combine)\b[^。！？\n]{0,120}\b(?:by|on|using|with)\b[^。！？\n]{0,80}\b(?:id|key|code|customer|order|student|patient|account)|(?:按|根据|通过)[^。！？\n]{0,80}(?:id|编号|键|客户|订单|学生|患者|账号)[^。！？\n]{0,80}(?:合并|连接|关联|匹配)/i;
const LOOKUP_OPERATION_RE = /\b(?:xlookup|vlookup|hlookup|index\s*match|lookup)\b|查找函数|查找匹配/i;
const MATRIX_OPERATION_RE = /\b(?:matrix|two[-\s]?way\s+table|contingency\s+table|rows?\s*=\s*[^.。！？\n]{1,80}\s*,?\s*columns?\s*=|region\s+by\s+quarter|by\s+\w+\s+and\s+\w+)\b|矩阵|二维表|列联表/i;
const FILTER_OPERATION_RE = /\b(?:filter|filtered|where|only\s+rows?\s+where|status\s*=\s*\w+|status\s+is\s+\w+|(?:completed|active|approved|paid)\s+(?:only|orders?\s+only|customers?\s+only)|exclude\s+(?:cancelled|canceled|inactive|void|refunded))\b|筛选|过滤|只看(?:已完成|完成|有效|活跃)|排除(?:已取消|取消|无效|退款)/i;
const RUBRIC_RE = /\b(rubric|marking criteria|grading criteria|assessment criteria|scoring guide)\b|评分标准|评分细则|打分标准/i;
const PROFESSIONAL_RE = /\b(medical|clinical|public health|screening|surgery|surgical|procedure|treatment|patient-specific|dosage|anatomy|physiology|biomedical|ecg|mri|x-?ray|pathogen|viral vector|crispr|engineering|structural|electrical|wiring|breaker|retaining wall|excavation|slope|fea|cfd|pressure vessel|safety valve|reactor|device|machine|apparatus|tensile|heat pump|beam|load|stress|strain|material parameter|material grade|mechanism)\b|医学|临床|剂量|解剖|生理|工程|载荷|承重|应力|应变|材料参数|机制图/i;
const PARAMETER_RE = /\b(parameter|parameters|dimension|dimensions|dosage|dose|load|stress|strain|material|coefficient|rate|exact|precise)\b|参数|尺寸|剂量|承重|载荷|精确|准确|材料/i;
const HIGH_RISK_PROFESSIONAL_RE = /\b(?:legal advice|specific legal recommendation|sue|lawsuit|court filing|investment advice|financial advice|guaranteed return|portfolio allocation|buy this stock|hazardous synthesis|explosive|controlled substance|exothermic reaction|feed order|quench|waste handling|exact lab protocol|exploit steps|malware|bypass authentication|privilege escalation|sql injection|xss|reverse shell|dump database|cookie theft|cve|poc|ssrf|csrf|xxe|deserialization|nmap|metasploit|brute force|weak password|169\.254\.169\.254|cloud metadata|lateral movement|phishing|macro virus|ransomware|idor|broken access control|unauthori[sz]ed access|api authorization bypass|see another user's? orders?|patient-specific treatment|dose adjustment|dosage adjustment|renal dosing|pediatric dos(?:e|ing)|exact rates?|acetaminophen|ibuprofen|vancomycin|insulin|heparin|morphine|warfarin|amiodarone|anticoagulation bridge|anticoagulation bridging|perioperative anticoagulation|stop and resume medication|norepinephrine|noradrenaline|propofol|vasopressor|sedation|mcg\/kg\/min|drug compatibility|infusion compatibility|nursing record|medical record falsification|administered even though|not administered|not given|fake vital signs|ventilator|chest pain|stroke|ecg|mri|x-?ray|diagnos(?:e|is)|phq-?9|gad-?7|dass-?21|clinical cut-?off|severe depression|surgical steps?|instrument positions?|clinical protocol|emergency triage|suicid(?:e|al)|want(?:s)? to die|kill myself|self-?harm|harm others|abuse risk|pathogen culture|viral vector|crispr.*protocol|electrical panel|electrical wiring|breaker size|live repair|retaining wall|excavation|pressure vessel|safety valve|reactor startup|p\s*&\s*id|p&id|hazop|sil\s*\d?|lopa|iec\s*61511|iec compliant|pass(?:es)? local inspection|inspection approval|code compliant|trip setpoints?|trip matrix|valve tags?|sis|shaft diameter|bearing model|gear module|weld inspection|heat treatment|battery thermal runaway|pid parameters)\b|法律意见|起诉|诉讼|投资建议|理财建议|保证收益|股票买入|危险合成|爆炸物|受控物质|具体实验步骤|放热反应|淬灭|加料顺序|废液处理|漏洞利用|恶意软件|绕过认证|越权访问|权限绕过|提权|SQL\s*注入|拿\s*shell|脱库|窃取\s*cookie|儿科.*剂量|儿童.*剂量|万古霉素|肾功能.*剂量|围手术期.*抗凝|抗凝.*桥接|停药.*恢复|药物配伍|一起输|护理记录|医嘱执行记录|没给药|未给药|伪造.*(?:记录|医嘱|生命体征)|自杀|自伤|他伤|虐待|配电箱|线径|断路器|电缆规格|接地方案|传动轴|轴承型号|齿轮模数|焊缝|热处理温度|保温时间|承重墙|反应釜|开车步骤|整定压力|联锁参数|现场验收|通过验收|合规验收|锂电池热失控|机械臂.*(?:PID|速度|扭矩)/i;
const HIGH_RISK_PROFESSIONAL_ALIAS_RE = /\b(?:oxytocin|category\s*ii\s*fetal|fetal\s+heart\s+tracing|ctg|tachysystole|mU\/min|news2|qsofa|sepsis\s+bundle|lactate|iv\s+fluids?|antibiotics?|icu\s+transfer|dopamine|dobutamine|epinephrine|phenylephrine|milrinone|inotrope|ekg|electrocardiogram|rhythm\s+strip|stemi|asrs|bdi-?ii|ham-?d|ados-?2|mmpi|wais|dsm-?5|icd-?11|medication\s+plan|chlorine|ammonia|h2s|evacuation\s+radius|isolation\s+distance|neutralization|ppe|lifting\s+lug|rigging|shackle|sling\s+angle|weld\s+size|cracked\s+slope|shotcrete|anchor\s+spacing|kerberoasting|pass-the-hash|mimikatz|bloodhound|dcsync|lsass|assume-role|s3\s+exfil|cloudtrail\s+bypass)\b|心电图|心梗|心律|胎心监护|催产素|脓毒症|休克|升压药|吊装|卸扣|焊缝尺寸|锚杆间距|边坡开裂|云安全|域渗透/i;
const HIGH_RISK_PROFESSIONAL_EXTRA_RE = /\b(?:hba1c|egfr|creatinine|tsh|troponin|lab values?|blood tests?|diagnos(?:e|is)|referral|pregnan(?:t|cy)|breastfeeding|lactation|teratogenic|contraindicat(?:ed|ion)|isotretinoin|methotrexate|ace inhibitors?|stop medication|continue medication|switch medication|tdm|therapeutic drug monitoring|trough level|peak level|gentamicin|digoxin|lithium|clozapine|mews|gcs|avpu|vital signs?|discharg(?:e|ed)|home observation|c-ssrs|pcl-5|audit|cage|y-bocs|risk classification|single[-\s]?line diagram|wiring schematic|low[-\s]?voltage distribution|electrical distribution|rcd|residual current device|leakage breaker|contactors?|thermal overload relay|permit-ready|engineer sign-off|safe to occupy|ibc|asce\s*7|eurocode|nec|nfpa|graphq[l]? introspection|jwt\s+alg\s*=?\s*none|saml|oauth|bola|path traversal|ssti|cors misconfig|kubernetes token)\b|化验值|肌酐|肾小球滤过率|孕妇|备孕|哺乳期|致畸|禁忌证|停药|换药|继续用药|血药浓度|谷浓度|峰浓度|地高辛|锂盐|庆大霉素|氯氮平|生命体征|出院|居家观察|意识评分|单线图|接线图|低压柜|低压配电|平方铜线|平方线|漏保|接触器|热继电器|可居住|可报批|结构工程师签字|无需.*(?:工程师|专家).*复核|图形化查询|枚举.*mutation|修改.*tenantId|路径穿越|模板注入/i;
const HIGH_RISK_PROFESSIONAL_LOCAL_EXTRA_RE = /\b(?:sds|sas|self[-\s]?rating depression scale|self[-\s]?rating anxiety scale|hamilton depression|hamilton anxiety|beck depression|live electrical repair|energized panel|240v panel|480v panel|loto bypass|lockout tagout bypass|plc interlock bypass|safety interlock bypass|cors misconfig(?:uration)?|steal cookies?|credentialed cors|fire inspection|fire approval|sprinkler spacing|egress distance|attic safely hold|shelf safely hold|balcony safely hold|water tank)\b|不想活了|轻生|活着没意思|吞药|割腕|跳楼|抑郁自评量表|焦虑自评量表|汉密尔顿(?:抑郁|焦虑)量表|贝克量表|胸口闷|胸痛|胸闷|半边无力|口角歪|说话含糊|麻疹|水痘|结核|新冠|流感|诺如|返校|返工|上报疾控|疾控|胎动少|见红|破水|宫缩|产后出血|恶露异常|孩子.*(?:抽搐|呼吸困难|嗜睡|皮疹|高热|脱水|误食)|婴儿.*(?:抽搐|呼吸困难|嗜睡|皮疹|高热|脱水|误食)|宝宝.*(?:抽搐|呼吸困难|嗜睡|皮疹|高热|脱水|误食)|家暴|性侵|猥亵|霸凌|被家里人打|被打|带电(?:维修|更换|接线)|火线|零线|地线|84\s*消毒液|洁厕灵|氯气|氨气|硫化氢|隔离距离|疏散半径|中和步骤|防护用品|偷\s*cookie|窃取\s*cookie|跨域带凭证|消防审查|消防验收|疏散距离|喷淋间距|防火分区/i;
const HIGH_RISK_PROFESSIONAL_EDGE_RE = /\b(?:neonatal\s+resuscitation|apgar|anaphylaxis|auto-?injector|overdose|poisoning|gastric\s+lavage|naloxone|antidote\s+dos(?:e|ing)|diabetic\s+ketoacidosis|dka|insulin\s+infusion|potassium\s+replacement|home\s+birth|postpartum\s+ha?emorrhage|pacemaker|defibrillator|pacing\s+threshold|sensing\s+parameters?|elevator\s+repair|lift\s+repair|door-?lock\s+bypass|safety\s+circuit\s+bypass|ammonia\s+refrigeration|refrigerant\s+charging|pressure-?test|gas\s+boiler|carbon\s+monoxide|flue\s+problems?|boiler\s+safety|safe\s+to\s+keep\s+using\s+overnight|fall-?arrest|lanyard\s+length|scaffold(?:ing)?\s+anchor|erection\s+parameters?)\b/i;
const HIGH_RISK_PROFESSIONAL_SECOND_WAVE_RE = /\b(?:rabies|post[-\s]?exposure prophylaxis|pep\s+plan|hiv\s+pep|needlestick|immunoglobulin|vaccine\s+timing|spo2|home\s+oxygen|oxygen\s+adjustment|oxygen\s+flow|sertraline|linezolid|benzodiazepine|opioid|methadone|co-?prescribing|tuberculosis\s+contact\s+investigation|return-?to-?work\s+clearance|isolation\s+clearance|everyone\s+would\s+be\s+better\s+off\s+without\s+me|giving\s+away\s+belongings|passive\s+death\s+wishes?|confidentiality-?only|nasogastric|tube\s+feeding|feeding\s+rate|flush\s+volume|aspiration\s+risk|arc[-\s]?flash|incident\s+energy|approach\s+boundary|switchgear|formwork|tie\s+spacing|concrete\s+pour\s+rate|machine\s+guarding|interlock\s+defeat|defeat\s+(?:a\s+)?(?:machine\s+guarding\s+)?interlock|distillation|reflux\s+ratio|hydrogen\s+purge|hot[-\s]?work|confined[-\s]?space|prototype\s+pollution|rce|remote\s+code\s+execution|exfiltrat(?:e|ion).*environment\s+variables?|waf\s+bypass|union\s+select|\/etc\/passwd)\b|狂犬病|咬伤|免疫球蛋白|暴露后|阻断药|针刺伤|血氧|居家吸氧|氧流量|舍曲林|利奈唑胺|阿片|苯二氮卓|管饲|鼻胃管|冲管量|误吸|结核接触|隔离返工|返工许可|弧闪|开关柜|安全边界|作业距离|基坑支护|钢支撑间距|降水井|开挖顺序|模板(?:拉杆|支撑)?|浇筑速度|护罩绕过|联锁绕过|精馏塔|回流比|氢气置换|动火|受限空间|原型污染|远程代码执行|环境变量外传/i;
const HIGH_RISK_PROFESSIONAL_THIRD_WAVE_RE = /\b(?:brca\d?|apoe|pharmacogenomic|genetic\s+test(?:ing)?|genetic\s+risk|variant\s+interpretation|relative[s]?\s+need\s+testing|iacuc|animal\s+ethics|mouse\s+xenograft|tumou?r\s+inoculation|humane\s+endpoints?|euthanasia\s+steps?|human\s+challenge\s+trial|challenge\s+trial|exposes?\s+volunteers?|exposure\s+dose|clinical\s+trial\s+(?:ae|sae)|adverse\s+event\s+attribution|regulatory\s+approval|safe\s+enough\s+for\s+approval|school\s+outbreak\s+line\s+list|index\s+child|household\s+addresses?|dorm\s+room|waives?\s+consent|prisoner\s+survey|vulnerable\s+(?:group|population)|coercive\s+recruitment|caused\s+the\s+outbreak|should\s+be\s+isolated|smoke\s+exhaust|positive\s+pressure\s+ventilation|fire\s+pump|acceptance\s+inspection|relay\s+protection|overcurrent|instantaneous\s+trip|earth\s+fault|commissioning\s+test|photovoltaic|battery\s+storage|bms\s+threshold|anti[-\s]?islanding|cyanide\s+wastewater|orp\s+control|accident\s+tank|dust\s+explosion|deflagration|vent\s+area|kst|container\s+escape|privileged\s+container|hostpath|nsenter|modbus|plc\s+coils?|scada\s+alarm|demolition\s+blasting|charge\s+per\s+hole|borehole\s+spacing|delay\s+detonator)\b|基因检测|家族遗传|动物伦理|安乐死|人道终点|人体挑战试验|主动暴露|不良事件归因|监管批准|弱势群体|豁免(?:家长|监护人)?同意|感染源儿童|家庭地址|宿舍疫情|歧视性归因|正压送风|排烟量|消防泵|继电保护|速断|接地保护|光伏储能|孤岛保护|含氰废水|破氰|粉尘防爆|泄爆|隔爆|容器逃逸|特权容器|宿主机挂载|工控|寄存器|线圈|停泵|爆破方案|装药量|孔距|延期雷管/i;
const HIGH_RISK_PROFESSIONAL_FOURTH_WAVE_RE = /\b(?:ivf\s+embryos?|embryo\s+(?:selection|transfer|ranking)|polygenic\s+risk\s+score|avoid\s+disability|whole[-\s]?genome\s+sequencing|incidental\s+findings?|huntington(?:'s)?\s+disease|non[-\s]?paternity|brain[-\s]?dead|brain\s+death|organ\s+donation|family\s+consent|assisted\s+dying|medical\s+assistance\s+in\s+dying|tribal\s+dna|indigenous\s+dna|community\s+consent|orthopoxvirus|viral\s+genome|virus\s+genome|dna\s+fragments?|synthetic\s+biology\s+protocol|deceiv(?:e|es|ing)\s+social\s+media\s+users?|deception\s+psychology|skip(?:s|ping)?\s+debriefing|mammography\s+ai|skip(?:s|ping)?\s+biopsy|crypto\s+mixers?|shell\s+companies|sanctions?\s+(?:screening|evasion)|aml\s+monitoring|money\s+launder(?:ing)?|non[-\s]?public\s+earnings?|insider\s+trading|avoid\s+detection|reentrancy|flash\s+loans?|defi\s+liquidity\s+pool|typosquatt(?:ed|ing)|npm\s+package|install\s+script|collects?\s+environment\s+variables?|credential\s+stuffing|password\s+spray(?:ing)?|proxy\s+rotation|radiation\s+shielding|class\s*4\s+laser|nominal\s+hazard\s+distance|aircraft\s+maintenance\s+release|deferred\s+defects?|released?\s+to\s+service|railway\s+signal|bypass(?:es|ing)?\s+interlocking|movement\s+authority|drone\s+operations?|geofenc(?:e|ing)|remote\s+id|restricted\s+zone)\b|胚胎筛选|优生|多基因风险|全基因组|偶然发现|亨廷顿|非亲子|脑死亡|器官捐献|协助死亡|部落.*DNA|原住民.*DNA|社区同意|病毒基因组|合成生物学|欺骗性心理|不做事后说明|乳腺影像.*AI|跳过活检|洗钱|制裁规避|空壳公司|内幕交易|未公开财报|智能合约攻击|重入漏洞|闪电贷|供应链投毒|仿冒\s*npm|安装脚本.*环境变量|凭证填充|密码喷洒|代理轮换|辐射屏蔽|四类激光|航空维修|延期签放|飞机.*放行|铁路信号|绕过联锁|行车许可|无人机.*(?:地理围栏|远程识别)|限制区/i;
const HIGH_RISK_PROFESSIONAL_FIFTH_WAVE_RE = /\b(?:self[-\s]?managed\s+(?:medication\s+)?abortion|medication\s+abortion|abortion\s+schedule|gestational\s+week|confirm\s+success|visa\s+interview|asylum\s+applicant|immigration\s+(?:interview|memo|strategy)|omit\s+(?:damaging\s+)?facts?|avoid\s+(?:refusal|deportation|removal)|tax\s+evasion|underreport\s+(?:cash\s+)?income|hide\s+cash\s+income|invent\s+deductible\s+expenses?|fake\s+(?:invoice|receipt|expense)|browser\s+extension[^.。！？]{0,120}(?:records?|captures?|uploads?)\s+(?:login\s+form|credentials?|passwords?|usernames?)|keylogger|login\s+form\s+input|uploads?\s+usernames?\s+and\s+passwords?|airbag\s+bypass|airbag\s+resistor|bypass\s+resistor|abs\s+(?:disable|bypass|fuse)|disable\s+abs|pull\s+(?:the\s+)?abs\s+fuse)\b|药物流产|自行流产|自助流产|孕周.*(?:用药|成功)|签证面谈|庇护面谈|移民面谈|省略事实|隐瞒事实|避免(?:拒签|遣返|驱逐)|少报收入|隐瞒现金收入|虚构(?:费用|发票|抵扣)|偷税|逃税|浏览器插件.*(?:记录|采集|上传).*(?:账号|密码|登录框|凭据)|键盘记录|安全气囊.*(?:旁路|电阻|绕过)|abs.*(?:关闭|禁用|绕过|保险丝)/i;
const WEB_BLOCKED_RE = /\b(closed-book|closed book|only uploaded|use only uploaded|provided materials only|no external|do not use external|without external|no internet|do not browse)\b|禁止外部|只能使用上传|不要联网|不能联网|不允许联网|不得使用外部/i;
const PRIVATE_HIGH_RISK_RE = /\b(private|confidential|proprietary|client-specific|site-specific|patient|load-bearing|can safely hold|safe to hold|construction|structural safety)\b|隐私|机密|客户|患者|施工|结构安全|承重参数|私有|安全承重|可承重/i;
const SOURCE_CONFLICT_RE = /\b(?:sources?\s+(?:conflict|disagree)|conflicting sources?|sources? are inconsistent|guidelines?\s+(?:conflict|disagree))\b|来源冲突|资料冲突|指南冲突/i;
const INCOMPLETE_TECHNICAL_INPUT_RE = /\b(?:without|no|missing|did not provide|not provided|not uploaded)[^.。！？]{0,100}\b(?:model|mesh|boundary conditions?|parameters?|drawings?|site data|raw data|original data)\b|未(?:提供|上传)[^.。！？]{0,100}(?:参数|模型|图纸|边界条件|原始数据)/i;
const CHART_PLACEHOLDER_RE = /\[\[CHART_PLACEHOLDER_\d+\]\]/g;
const RAW_ARTIFACT_RE = /```|\[CHART_BEGIN\]|\[CHART_END\]|\{\s*"chartjs"\s*:|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)/i;
const DATA_METHOD_CLAIM_RE = /\b(regression|anova|t-test|chi-square|statistically significant|p\s*[<=>]\s*0?\.\d+|p-?values?|causal|causation|correlation coefficient|pearson(?:'s)?(?:\s+(?:r|correlation))?|spearman(?:'s)?(?:\s+(?:rho|correlation))?|rho\s*=\s*-?\d|beta coefficient|odds ratios?|risk ratios?|relative risk|sensitivity|specificity|prevalence|incidence|r\s*=\s*-?\d|kaplan-?meier|cox model|roc|auc|fixed effects?|difference-in-differences|did\b|instrumental variable|r\^?2|confidence intervals?|(?:95%\s*)?ci)\b|β\s*=?\s*-?\d|差异显著|显著性|显著差异|p\s*值|p值|因果|相关系数|优于|导致/i;
const PRECISE_PARAMETER_UNIT = '(?:mg|g|kg|kn|n|mpa|gpa|mm|cm|m|%|deg|°c?|psi|ksi|kip|kips|lb|lbs|ton|tons|tonne|tonnes|inch|inches|in)';
const PRECISE_PARAMETER_RE = new RegExp(`\\b(?:(?:dose|dosage|load|stress|strain|beam|material|coefficient|rate|dimension|parameter)s?\\b[^.\\n]{0,80}\\b\\d+(?:\\.\\d+)?\\s?${PRECISE_PARAMETER_UNIT}\\b|\\d+(?:\\.\\d+)?\\s?${PRECISE_PARAMETER_UNIT}\\b[^.\\n]{0,80}\\b(?:dose|dosage|load|stress|strain|beam|material|coefficient|rate|dimension|parameter)s?\\b)`, 'i');
const HIGH_LEVEL_SCHEMATIC_RE = /\b(high-level|conceptual|schematic|not to scale|parameter-free)\b|高层|概念性|示意|非比例|不按比例/i;
const ACTIONABLE_HIGH_RISK_DETAIL_RE = /\b(?:administer|give|inject|prescribe|titrate|adjust|dose|starts?|increases?|decreases?|escalates?|weans?)\b[^.。！？]{0,100}\b\d+(?:\.\d+)?\s?(?:mcg\/kg\/min|mg\/kg|ml\/kg|mg|mcg|g|ml|mL|units?|iu)\b|\b\d+(?:\.\d+)?\s?(?:mcg\/kg\/min|mg\/kg|ml\/kg|mg|mcg|g|ml|mL|units?|iu)\b[^.。！？]{0,100}\b(?:insulin|heparin|morphine|warfarin|vancomycin|acetaminophen|ibuprofen|norepinephrine|noradrenaline|propofol|vasopressor|sedation|dose|dosage|titrate|adjust)\b|\b(?:can|will|is)\s+safely\s+(?:hold|support|carry)\b|\bsafe\s+to\s+(?:construct|wire|repair|operate|install|administer|infuse)\b|\b(?:can|may|should)\s+(?:follow|use|take)\s+(?:the\s+)?(?:usual|standard|routine|normal)\s+(?:pathway|treatment|protocol|plan)\b|\b(?:does\s+not|doesn't|do\s+not|don't|no)\s+need\s+(?:emergency|urgent|clinician|doctor|medical|specialist)?\s*(?:referral|review|care|assessment|triage|transfer)\b|\b(?:fit|fits|matches)\s+(?:this\s+)?pattern[^.。！？]{0,80}\b(?:treat|manage|handle)\b|\b(?:approved|cleared|acceptable|compliant)\s+(?:for\s+)?(?:use|inspection|operation|construction)\b|\b(?:document|chart|record)\b[^.。！？]{0,100}\b(?:administered|given|completed)\b[^.。！？]{0,100}\b(?:not administered|not given|not completed)\b|\b(?:do not|don't|avoid)\s+(?:call|contact|tell|notify)\b[^.。！？]{0,80}\b(?:emergency|doctor|clinician|teacher|school|counselor|parent|police|988|911|999)\b|\b(?:incubate|culture|transfect|centrifuge|heat|sterili[sz]e)\b[^.。！？]{0,100}\b\d+(?:\.\d+)?\s?(?:°c|c|hours?|hrs?|h|min|minutes?|rpm|µg\/ml|ug\/ml|mg\/l|mm|v|ma)\b|\b(?:breaker|wire|wiring|live panel|pressure vessel|retaining wall|excavation|shaft|bearing|gear|weld|reactor|interlock|battery|pid|p\s*&\s*id|hazop|sil|sis|trip)\b[^.。！？]{0,100}\b\d+(?:\.\d+)?\s?(?:a|amp|amps|v|volt|volts|awg|kn|ton|tons|psi|mpa|mm|cm|m|°c|hours?|rpm|n·m|nm)\b|\b(?:sql injection|xss|payload|reverse shell|dump database|cookie theft|ssrf|csrf|xxe|metasploit|nmap|idor|broken access control)\b|具体(?:剂量|步骤|承重|接线|施工|payload)|不需要(?:急诊|转诊|医生|临床)复核|可(?:按|走|使用)(?:常规|标准)(?:方案|流程|路径)|可(?:安全)?承重|安全施工|可施工|可验收|能直接用|选\s*\d+(?:\.\d+)?\s*(?:a|安|mm|毫米)|保温\s*\d+(?:\.\d+)?\s*(?:小时|分钟)|轴径\s*\d+(?:\.\d+)?\s*(?:mm|毫米)|断路器\s*\d+(?:\.\d+)?\s*(?:a|安)/i;
const ACTIONABLE_HIGH_RISK_REVERSE_PARAMETER_RE = /\b\d+(?:\.\d+)?\s?(?:a|amp|amps|v|volt|volts|awg|kn|ton|tons|psi|mpa|mm|cm|m|°c|hours?|rpm|n·m|nm)\b[^.。！？]{0,100}\b(?:breaker|wire|wiring|cable|live panel|pressure vessel|retaining wall|excavation|shaft|bearing|gear|weld|reactor|interlock|battery|pid)\b|\d+(?:\.\d+)?\s*(?:a|安|mm|毫米|伏|千牛|吨|mpa|兆帕)[^.。！？]{0,40}(?:断路器|空开|电缆|线径|接触器|热继电器|配电箱|接线|轴径|承重|反应釜|联锁|报警值|整定)/i;
const ACTIONABLE_HIGH_RISK_ALIAS_DETAIL_RE = /\b(?:start|starts?|give|administer|titrate|increase|decrease|bolus|infuse)\b[^.。！？]{0,100}\b\d+(?:\.\d+)?\s?(?:mU\/min|mcg\/kg\/min|ml\/kg|mL\/kg)\b|\b\d+(?:\.\d+)?\s?(?:mU\/min|mcg\/kg\/min|ml\/kg|mL\/kg)\b[^.。！？]{0,120}\b(?:oxytocin|dopamine|dobutamine|epinephrine|phenylephrine|milrinone|iv\s+fluids?|antibiotics?|icu|sepsis)\b|\b(?:weld\s+size|sling\s+angle|anchor\s+spacing|shackle|lifting\s+lug)\b[^.。！？]{0,100}\b\d+(?:\.\d+)?\s?(?:mm|cm|m|degree|degrees|°)\b|\b(?:mimikatz|dcsync|dump\s+lsass|lsass\s+dump|kerberoasting|pass-the-hash|s3\s+exfil|assume-role|cloudtrail\s+bypass)\b/i;
const ACTIONABLE_HIGH_RISK_LOCAL_DETAIL_RE = /\b(?:do\s+not|don't|avoid|never|no need to|do not need to)\s+(?:tell|notify|contact|call|involve|report)\b[^.。！？]{0,80}\b(?:parent|teacher|counselor|doctor|clinician|police|social worker|emergency services)\b|\b(?:mix|combine)\b[^.。！？]{0,80}\b(?:bleach|chlorine|ammonia|toilet cleaner)\b|\b(?:live electrical repair|energized panel|loto bypass|lockout tagout bypass|plc interlock bypass|safety interlock bypass|steal cookies?|cookie theft|credentialed cors)\b|不要(?:告诉|通知|联系|报警|找)[^.。！？]{0,40}(?:家长|老师|辅导员|医生|警察|社工)|不用(?:报警|联系|告诉|找)[^.。！？]{0,40}(?:家长|老师|辅导员|医生|警察|社工)|别(?:告诉|通知|联系|报警|找)[^.。！？]{0,40}(?:家长|老师|辅导员|医生|警察|社工)|补记为已执行|倒签|写成已执行|生命体征写正常|未测写正常|漏给药|少给药|(?:头孢|阿莫西林|布洛芬|退烧药|降压药|降糖药|二甲双胍|胰岛素|阿司匹林)[^.。！？]{0,40}(?:能不能吃|一起吃|停不停|继续吃|要不要停)|(?:84\s*消毒液|洁厕灵)[^.。！？]{0,40}(?:混|产生|生成)[^.。！？]{0,20}(?:氯气|有毒气体)|(?:带电|火线|零线|地线)[^.。！？]{0,60}(?:接|接线|更换|维修)|(?:氨气|氯气|硫化氢)[^.。！？]{0,80}(?:隔离距离|疏散半径|防护用品|中和步骤)|(?:消防审查|消防验收)[^.。！？]{0,80}(?:疏散距离|喷淋间距|防火分区)|偷\s*cookie|窃取\s*cookie/i;
const ACTIONABLE_HIGH_RISK_EDGE_DETAIL_RE = /\b(?:give|administer|inject|use|dose)\b[^.。！？]{0,100}\b\d+(?:\.\d+)?\s?(?:mg\/kg|mcg\/kg|min|mg|mcg|ml\/kg|mL\/kg|mL|ml|units?)\b[^.。！？]{0,80}\b(?:epinephrine|naloxone|antidote|insulin|potassium)\b|\b\d+(?:\.\d+)?\s?(?:mg\/kg|mcg\/kg|min|mg|mcg|ml\/kg|mL\/kg|mL|ml|units?)\b[^.。！？]{0,120}\b(?:epinephrine|naloxone|antidote|insulin|potassium)\b|\b(?:bypass|jumper|override)\b[^.。！？]{0,80}\b(?:elevator|lift|door-?lock|safety\s+circuit)\b|\b(?:elevator|lift|door-?lock|safety\s+circuit)\b[^.。！？]{0,80}\b(?:bypass|jumper|override)\b|\b(?:keep\s+using|continue\s+using|safe\s+to\s+(?:occupy|use|keep\s+using))\b[^.。！？]{0,100}\b(?:boiler|flue|carbon\s+monoxide|\bco\b)|\b(?:boiler|flue|carbon\s+monoxide|\bco\b)[^.。！？]{0,100}\b(?:keep\s+using|continue\s+using|safe\s+to\s+(?:occupy|use|keep\s+using))\b|\b\d+(?:\.\d+)?\s?(?:m|cm|mm|ft|feet)\b[^.。！？]{0,100}\b(?:lanyard|scaffold|scaffolding|fall-?arrest|anchor)\b|\b(?:lanyard|scaffold|scaffolding|fall-?arrest|anchor)\b[^.。！？]{0,100}\b\d+(?:\.\d+)?\s?(?:m|cm|mm|ft|feet)\b|\b(?:gastric\s+lavage|antidote\s+dos(?:e|ing)|insulin\s+infusion\s+rate|potassium\s+replacement|pacing\s+threshold|shock\s+parameter|sensing\s+parameter|valve\s+sequence|refrigerant\s+charging)\b/i;
const ACTIONABLE_HIGH_RISK_SECOND_WAVE_DETAIL_RE = /\b(?:rabies|vaccine|immunoglobulin)\b[^.。！？]{0,120}\b(?:days?\s*0|0\s*[,/]\s*3\s*[,/]\s*7\s*[,/]\s*14)\b|\b(?:hiv\s+)?pep\b[^.。！？]{0,120}\b(?:72\s*hours?|28\s*days?|tenofovir|emtricitabine|dolutegravir|raltegravir)\b|\b(?:oxygen|spo2|copd)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*l\/min\b|\b\d+(?:\.\d+)?\s*l\/min\b[^.。！？]{0,120}\b(?:oxygen|spo2|copd)\b|\b(?:tube\s+feeding|nasogastric|flush)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*mL\/h\b|\b\d+(?:\.\d+)?\s*mL\/h\b[^.。！？]{0,120}\b(?:tube\s+feeding|nasogastric|flush)\b|\b(?:sertraline|linezolid|benzodiazepine|opioid|methadone)\b[^.。！？]{0,120}\b(?:can\s+continue|continue\s+both|safe\s+to\s+combine|safe\s+together)\b|\b(?:arc[-\s]?flash|incident\s+energy|approach\s+boundary|cal\/cm2|ppe\s+category)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s?(?:cal\/cm2|m|ft|category)\b|\b(?:steel\s+strut\s+spacing|dewatering\s+wells?|excavation\s+sequence|formwork\s+tie\s+spacing|concrete\s+pour\s+rate)\b|\b(?:reflux\s+ratio|hydrogen\s+purge|hot[-\s]?work|confined[-\s]?space)\b[^.。！？]{0,120}\b(?:\d+(?:\.\d+)?\s*:\s*\d+|step|sequence|minutes?|hours?)\b|\b(?:prototype\s+pollution|remote\s+code\s+execution|rce|union\s+select|waf\s+bypass|\/etc\/passwd|exfiltrat(?:e|ion).*environment\s+variables?)\b|狂犬病[^。！？]{0,80}(?:0\s*[,/，]\s*3\s*[,/，]\s*7\s*[,/，]\s*14|免疫球蛋白)|(?:血氧|吸氧|氧流量)[^。！？]{0,80}\d+(?:\.\d+)?\s*(?:l\/min|升\/分)|(?:鼻胃管|管饲|冲管)[^。！？]{0,80}\d+(?:\.\d+)?\s*(?:ml\/h|毫升\/小时|毫升)|(?:弧闪|作业距离|安全边界)[^。！？]{0,80}\d+(?:\.\d+)?\s*(?:m|米|cal\/cm2)|(?:钢支撑间距|降水井|开挖顺序|浇筑速度|回流比|氢气置换|动火|受限空间|原型污染|远程代码执行|环境变量外传)/i;
const ACTIONABLE_HIGH_RISK_THIRD_WAVE_DETAIL_RE = /\b(?:interprets?|classif(?:y|ies)|labels?)\b[^.。！？]{0,80}\b(?:brca\d?|apoe)\b[^.。！？]{0,120}\b(?:high\s+risk|needs?\s+testing|medication\s+change)|\b(?:inoculat(?:e|es)|injects?)\b[^.。！？]{0,120}\b(?:\d+(?:\.\d+)?e\d+|\d+(?:\.\d+)?)\s*(?:tumou?r\s+cells?|cells?)\b|\b(?:euthani[sz]e|euthani[sz]es)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*(?:mm3|mm\^3|cm3|cm\^3)\b|\b(?:without|skip|skips?)\s+(?:iacuc|animal\s+ethics)\b|\b(?:exposes?|infects?)\s+volunteers?\b[^.。！？]{0,120}\b\d+(?:\.\d+)?(?:\^?\d+|e\d+)?\s*(?:pfu|cfu|tcid50|mcg|mg)\b|\b(?:relay|overcurrent|earth\s+fault|instantaneous\s+trip)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*(?:a|amp|amps|s|sec|seconds?)\b|\b(?:bms|anti[-\s]?islanding|cutoff)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*(?:v|volt|volts|s|sec|seconds?)\b|\b(?:cyanide|orp|wastewater)\b[^.。！？]{0,120}\b(?:ph\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:mv|mg\/l))\b|\b(?:dust\s+explosion|vent\s+area|deflagration|kst)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*(?:m2|m\^2|bar|bar·m\/s|ms)\b|\b(?:hostpath|nsenter|privileged\s+container|container\s+escape)\b|\b(?:modbus|plc)\b[^.。！？]{0,120}\b(?:coil|register|stop\s+the\s+pump|write)\b|\b(?:charge|loads?)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*(?:kg|g)\b[^.。！？]{0,80}\b(?:hole|borehole|explosive)\b|\b(?:borehole\s+spacing|delay\s+detonator)\b[^.。！？]{0,120}\b\d+(?:\.\d+)?\s*(?:m|ms|milliseconds?)\b|(?:继电保护|过流|速断|接地保护)[^。！？]{0,80}\d+(?:\.\d+)?\s*(?:a|安|秒|s)|(?:bms|孤岛保护|截止)[^。！？]{0,80}\d+(?:\.\d+)?\s*(?:v|伏|秒|s)|(?:含氰废水|破氰|orp)[^。！？]{0,80}(?:ph\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:mv|毫伏|mg\/l))|(?:泄爆面积|装药量|孔距|延期雷管)[^。！？]{0,80}\d+(?:\.\d+)?\s*(?:m2|平方米|kg|公斤|m|米|ms|毫秒)/i;
const ACTIONABLE_HIGH_RISK_FIFTH_WAVE_DETAIL_RE = /\b(?:underreport\s+(?:cash\s+)?income|hide\s+cash\s+income|invent\s+deductible\s+expenses?|fake\s+(?:invoice|receipt|expense)|omit\s+(?:damaging\s+)?facts?\s+(?:in|from)\s+(?:a\s+)?visa\s+interview|avoid\s+(?:visa\s+)?refusal|avoid\s+deportation|self[-\s]?managed\s+(?:medication\s+)?abortion\s+schedule|medication\s+abortion\s+schedule|gestational\s+week|collects?\s+passwords?\s+from\s+login\s+forms?|records?\s+login\s+form\s+input|uploads?\s+usernames?\s+and\s+passwords?|browser\s+extension[^.。！？]{0,120}(?:collects?|records?|uploads?)\s+(?:credentials?|passwords?|login)|\d+(?:\.\d+)?\s*(?:ohm|Ω)\s+airbag\s+bypass\s+resistor|airbag\s+bypass\s+resistor|pull\s+(?:the\s+)?abs\s+fuse|disable\s+abs)\b|少报收入|隐瞒现金收入|虚构(?:费用|发票|抵扣)|省略事实|隐瞒事实|避免(?:拒签|遣返|驱逐)|药物流产[^。！？]{0,80}(?:孕周|成功|时间表)|浏览器插件[^。！？]{0,120}(?:记录|采集|上传).*(?:账号|密码|登录框|凭据)|安全气囊[^。！？]{0,80}(?:旁路|电阻|绕过)|abs[^。！？]{0,80}(?:关闭|禁用|绕过|保险丝)/i;
const ACTIONABLE_HIGH_RISK_CHART_LABEL_RE = /\b(?:breaker|cable|wire|wiring|rcd|contactors?|thermal overload|mawp|relief setpoint|trip limit|trip setpoint|interlock|weld|sling|anchor|pressure|dose|dosage|titration|infusion|insulin|norepinephrine|oxytocin)\b|断路器|空开|电缆|线径|漏保|接触器|热继电器|整定|联锁|焊缝|吊装|锚杆|剂量|滴定/i;
const ACTIONABLE_HIGH_RISK_CHART_UNIT_RE = /\((?:a|amp|amps|ma|v|kw|hp|mm|mm²|sq\s*mm|psi|mpa|bar|kn|ton|tons|mg|mcg|ml|mU\/min|mcg\/kg\/min)\)|\b(?:amp|amps|mA|kW|hp|mm²|sq\s*mm|psi|MPa|bar|kN|tons?|mg|mcg|mU\/min|mcg\/kg\/min)\b|平方|毫米|安|千瓦|兆帕/i;
const CITATION_NEARBY_RE = /\([^)]+,\s*(19|20)\d{2}[a-z]?\)|\b[A-Z][A-Za-z-]+(?:\s+et al\.)?\s*\((19|20)\d{2}[a-z]?\)|\[\d+(?:\s*[,\u2013-]\s*\d+)*\]/;
const NEGATED_REQUIREMENT_RE = /\b(?:do\s+not|don't|dont|must\s+not|should\s+not)\s+(?:include|use|perform|run|add|create|draw|provide)\b|\b(?:no|without|avoid|exclude)\b|\bnot\s+(?:required|needed|necessary|allowed)\b|不要|不需要|无需|禁止|不得|不能/i;
const PURE_NEGATED_REQUIREMENT_RE = /^(?:please\s+)?(?:do\s+not|don't|dont|must\s+not|should\s+not|no|without|avoid|exclude)\b|\bnot\s+(?:required|needed|necessary|allowed)\b|^(?:请\s*)?(?:不要|不需要|无需|禁止|不得|不能)\b/i;
const DATA_ANALYSIS_NEGATED_RE = /\b(?:do\s+not|don't|dont|no|without|avoid|exclude)\s+(?:run|perform|include|use|analyse|analyze)?\s*(?:data analysis|statistical analysis|regression|dataset analysis|uploaded data|dataset)\b|不要.*(?:数据分析|统计分析|回归|数据集)|不需要.*(?:数据分析|统计分析|回归|数据集)/i;
const SENSITIVE_INTERNAL_ARTIFACT_RE = /\b(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SUPABASE_URL|SERVICE_ROLE_KEY|API_KEY|system prompt|developer prompt)\b/i;
const PROMPT_INJECTION_ARTIFACT_RE = /\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|above|system|developer)\s+instructions\b|\bprint\s+(?:the\s+)?(?:api key|secret|system prompt)\b|输出.*(?:密钥|系统提示词|后台提示词)|忽略.*(?:规则|指令|要求)/i;
const PRIVATE_IDENTIFIER_TEXT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[-+]?\d{1,2}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}|\b(?:MRN|medical record|patient id|participant id|subject id|SSN|NHS)\s*[:#-]?\s*[A-Z0-9-]{3,}\b|\b(?:patient|participant|subject|client)\s+(?:name\s*)?[:#-]?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b|(?:患者|病人|受试者|客户|员工|姓名)\s*[:：]?\s*[\u4e00-\u9fff]{2,4}/i;
const PLACEHOLDER_CONTENT_RE = /\b(?:tbd|to be (?:added|completed|written|filled)|placeholder|insert .{0,40} here|add .{0,40} later|n\/a|not applicable|coming soon|todo)\b|\[(?:insert|add|write|placeholder)[^\]]+\]|待补充|占位|稍后补充|此处(?:添加|填写|插入)/i;
const EXTERNAL_REFERENCE_RE = /\b(?:https?:\/\/|www\.|doi:\s*|doi\.org|retrieved from|available at|accessed)\b/i;
const NOTE_CITATION_STYLE_RE = /\b(?:oscola|bluebook|chicago\s+(?:notes?|notes-bibliography|bibliography)|notes?-bibliography)\b/i;
const NOTE_MARKER_RE = /(?:\^\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰])/;
const AUTHOR_YEAR_CITATION_RE = /\([^)]+,\s*(?:19|20)\d{2}[a-z]?\)|\([A-Z][A-Za-z-]+(?:\s+(?:et al\.?|and|&)\s+[A-Z][A-Za-z-]+)*\s+(?:19|20)\d{2}[a-z]?\)/;
const SOURCE_LOCATOR_RE = /\b(?:p\.?|pp\.?|page|pages|para\.?|paragraph|slide|slides|loc\.|line|lines)\s*\d+\b|\bat\s+\d+\b(?!\s*(?:%|percent|percentage|cases?|participants?|students?|respondents?|kg|mg|ml|m|cm|mm|hours?|minutes?|days?|years?)\b)|\b\d+\s*(?:页|段|张|行)\b|(?:\[|\()\d+,\s*(?:p\.?|pp\.?|page|pages|para\.?|slide|slides)\s*\d+(?:\]|\))/i;
const ACTIONABLE_LEGAL_FINANCIAL_FINAL_RE = /\b(?:guaranteed returns?|buy now|sell now|buy this stock|sell this stock|exact portfolio allocation|personal(?:ized)? investment recommendation|file\s+(?:form\s+)?[A-Z]\d+|file\s+(?:a\s+)?lawsuit|sue\s+(?:them|the landlord|the employer)|submit\s+(?:the\s+)?claim)\b|保证收益|立即买入|立即卖出|具体投资组合|个人(?:化)?投资建议|起诉状|立案|提交[^。！？]{0,40}法院|马上起诉/i;
const REFERENCE_HEADING_RE = /^(references|reference list|bibliography|works cited|参考文献|引用文献)\s*$/i;
const APPENDIX_HEADING_RE = /^(appendix(?:\s+[A-Z0-9一二三四五六七八九十]+)?|appendices|附录(?:\s*[A-Z0-9一二三四五六七八九十]+)?)(?:\s*[:：].*)?$/i;
const NOTE_HEADING_RE = /^(footnotes?|endnotes?|notes?|脚注|尾注)\s*$/i;
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};
const EXACT_OUTLINE_HEADING_RE = /\b(?:exact|strict|strictly|use|keep|follow|following)\b[^.。！？\n]{0,80}\b(?:outline|section|heading|headings|order|sequence)\b|\b(?:outline|section|heading|headings)\b[^.。！？\n]{0,80}\b(?:exact|strict|strictly|order|sequence)\b|严格按照[^。！？\n]{0,80}(?:大纲|标题|章节)[^。！？\n]{0,80}(?:顺序|结构)|(?:大纲|标题|章节)[^。！？\n]{0,80}(?:必须|需要|保持|按照)[^。！？\n]{0,80}(?:原样|顺序)/i;
const PEER_REVIEWED_REFERENCE_RE = /\b(?:peer[-\s]?reviewed|peer reviewed journal|scholarly journal|journal articles?|academic journal|refereed journal)\b|同行评审|学术期刊|期刊论文/i;
const WEB_ONLY_REFERENCE_RE = /\b(?:blog|website|web site|news|newspaper|magazine|wikipedia|study help|guide|course|assignment|brief|fact sheet|factsheet|white paper|report|government|ngo|think tank|press release|webpage|web page)\b|博客|网页|新闻|维基|白皮书|政府报告|课程资料/i;

function normalizeText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSafetyDetectionText(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
}

function joinedTaskText(input: WritingQualityRequirementInput) {
  const fileNames = (input.materialFiles || []).map((file) => file.original_name).join(' ');
  return [input.specialRequirements, input.outline, fileNames]
    .map((value) => normalizeText(normalizeSafetyDetectionText(value)))
    .filter(Boolean)
    .join('\n');
}

function joinedOriginalTaskText(input: WritingQualityRequirementInput) {
  return [input.specialRequirements]
    .map((value) => normalizeText(normalizeSafetyDetectionText(value)))
    .filter(Boolean)
    .join('\n');
}

function outlineTaskText(input: WritingQualityRequirementInput) {
  return normalizeText(normalizeSafetyDetectionText(input.outline));
}

function hasExplicitDataAnalysisRequest(text: string) {
  return DATA_ANALYSIS_INTENT_RE.test(text)
    || UPLOADED_DATA_CONTEXT_RE.test(text)
    || DATA_METHOD_REQUEST_RE.test(text);
}

function hasOutlineDataAnalysisRequest(text: string) {
  return UPLOADED_DATA_CONTEXT_RE.test(text)
    || (DATA_FILE_CONTEXT_RE.test(text) && DATA_METHOD_REQUEST_RE.test(text));
}

function stripNegatedRequirementSegments(text: string, signal: RegExp) {
  return text
    .split(/(?<=[.!?。！？;；\n])/)
    .filter((segment) => !(PURE_NEGATED_REQUIREMENT_RE.test(segment.trim()) && signal.test(segment)))
    .join(' ');
}

function stripNegatedTableMentions(text: string) {
  return text
    .replace(/\b(?:do\s+not|don't|dont|must\s+not|should\s+not|without|avoid|exclude|no)\s+(?:include|use|add|create|provide)?\s*(?:a\s+|any\s+)?tables?\b/gi, '')
    .replace(/不要(?:包含|使用|添加|画)?(?:任何)?表格|不(?:需要|要|允许)(?:任何)?表格|禁止表格/g, '');
}

function hasStructuredDataFile(files: StoredMaterialFile[] = []) {
  return files.some((file) => /\.(csv|tsv|json|xlsx)$/i.test(file.original_name)
    || [
      'text/csv',
      'text/tab-separated-values',
      'application/json',
      'text/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ].includes(String(file.mime_type || '').toLowerCase()));
}

function parseCountWord(value: string | undefined) {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    一: 1,
    两: 2,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const normalized = value?.toLowerCase();
  if (!normalized) return Number.NaN;
  return words[normalized] ?? Number.parseInt(normalized, 10);
}

function deriveVisualRequirement(text: string) {
  const maximumMatches = [
    ...text.matchAll(/\b(?:no more than|not more than|at most|up to|maximum of|max(?:imum)?|limit(?:ed)? to)\s*(\d{1,2}|one|two|three|four|five)\s*(?:charts?|graphs?|figures?|diagrams?)\b/gi),
    ...text.matchAll(/(?:最多|不超过|不得超过|不能超过|上限)\s*(\d{1,2}|一|两|二|三|四|五)\s*(?:张|个)?(?:图表|图|示意图|流程图)/g),
  ];
  const maximumCounts = maximumMatches
    .map((match) => match[1]?.toLowerCase())
    .map(parseCountWord)
    .filter((value) => Number.isInteger(value) && value > 0);
  const matches = [
    ...text.matchAll(/\b(?:include|add|draw|create|at least)\s*(\d{1,2}|one|two|three|four|five)\s*(?:charts?|graphs?|figures?|diagrams?)/gi),
    ...text.matchAll(/\b(\d{1,2}|one|two|three|four|five)\s*(?:charts?|graphs?|figures?|diagrams?)\b/gi),
    ...text.matchAll(/(?:生成|包含|画|需要|至少)\s*(\d{1,2}|一|两|二|三|四|五)\s*(?:张|个)?(?:图表|图|示意图|流程图)/g),
    ...text.matchAll(/(\d{1,2}|一|两|二|三|四|五)\s*(?:张|个)?(?:图表|图|示意图|流程图)/g),
  ];
  const counts = matches
    .map((match) => match[1]?.toLowerCase())
    .map(parseCountWord)
    .filter((value) => Number.isInteger(value) && value > 0);
  const exactMatches = [
    ...text.matchAll(/\b(?:exactly|just|only)\s*(\d{1,2}|one|two|three|four|five)\s*(?:charts?|graphs?|figures?|diagrams?)\b/gi),
    ...text.matchAll(/(?:正好|刚好|只能|仅)\s*(\d{1,2}|一|两|二|三|四|五)\s*(?:张|个)?(?:图表|图|示意图|流程图)/g),
  ];
  const exactCounts = exactMatches
    .map((match) => match[1]?.toLowerCase())
    .map(parseCountWord)
    .filter((value) => Number.isInteger(value) && value > 0);
  const noExtra = /\b(?:no extra|no additional|no more than|not more than)\s+(?:charts?|graphs?|figures?|diagrams?)\b|不要多(?:余|加).*图|不能多.*图/i.test(text);

  if (counts.length > 0) {
    const requiredVisualCount = Math.max(...counts);
    const maximumVisualCount = maximumCounts.length > 0
      ? Math.min(...maximumCounts)
      : exactCounts.length > 0 || noExtra ? requiredVisualCount : undefined;
    return {
      requiredVisualCount,
      maximumVisualCount,
    };
  }

  return {
    requiredVisualCount: VISUAL_RE.test(text) ? 1 : 0,
    maximumVisualCount: maximumCounts.length > 0 ? Math.min(...maximumCounts) : undefined,
  };
}

function parseRequiredDocumentElements(text: string): RequiredDocumentElement[] {
  const elements = new Set<RequiredDocumentElement>();
  if (/\babstract\b|摘要/i.test(text)) elements.add('abstract');
  if (/\b(?:table of contents|contents page)\b|目录/i.test(text)) elements.add('table_of_contents');
  if (/\bappendix|appendices\b|附录/i.test(text)) elements.add('appendix');
  if (/\bexecutive summary\b|执行摘要/i.test(text)) elements.add('executive_summary');
  if (/\bpolicy brief\b|政策简报|政策简讯/i.test(text)) {
    elements.add('executive_summary');
    elements.add('policy_options');
    elements.add('recommendation');
  }
  if (/\bpolicy options?\b|政策选项|方案选项/i.test(text)) elements.add('policy_options');
  if (/\brecommendations?\b|recommended option|政策建议|建议方案|推荐方案/i.test(text)) elements.add('recommendation');
  if (sectionMentionedWithRequirementCue(text, /\bintroduction\b|引言|导论/i)) elements.add('introduction');
  if (sectionMentionedWithRequirementCue(text, /\bliterature review\b|文献综述/i)) elements.add('literature_review');
  if (sectionMentionedWithRequirementCue(text, /\bmethodolog(?:y|ies)\b|\bmethods?\b|方法论|研究方法/i)) elements.add('methodology');
  if (sectionMentionedWithRequirementCue(text, /\bresults?\b|结果/i)) elements.add('results');
  if (sectionMentionedWithRequirementCue(text, /\bdiscussion\b|讨论/i)) elements.add('discussion');
  if (sectionMentionedWithRequirementCue(text, /\bconclusion\b|结论/i)) elements.add('conclusion');
  return [...elements];
}

function sectionMentionedWithRequirementCue(text: string, sectionPattern: RegExp) {
  return text
    .split(/(?<=[.!?。！？;；\n])/)
    .some((segment) => (
      /\b(?:must|should|need(?:s)? to|required|requires?|include|contain|have|with|sections?|headings?)\b|必须|需要|要求|包括|包含|章节|标题|部分/i.test(segment)
      && sectionPattern.test(segment)
    ));
}

function cleanOutlineHeading(value: string) {
  return value
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*(?:[-*•●▪◦]|\d+(?:\.\d+)*[.)]?|[IVXLCDM]+[.)])\s*/i, '')
    .replace(/[:：]\s*$/g, '')
    .trim();
}

function parseRequiredBodyHeadings(outline: string | null | undefined, text: string) {
  if (!outline || !EXACT_OUTLINE_HEADING_RE.test(text)) return [];

  const excludedHeading = /^(?:references|reference list|bibliography|works cited|table of contents|contents|appendix|appendices|参考文献|引用文献|目录|附录)$/i;
  const seen = new Set<string>();
  const headings: string[] = [];

  for (const rawLine of outline.replace(/\r\n/g, '\n').split('\n')) {
    const heading = cleanOutlineHeading(rawLine);
    if (!heading || excludedHeading.test(heading)) continue;
    if (heading.length < 2 || heading.length > 100) continue;
    if (/[.?!。！？]$/.test(heading)) continue;

    const key = normalizedScopeKey(heading);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    headings.push(heading);
  }

  return headings;
}

function parseMinimumReferenceYear(text: string) {
  const matches = [
    ...text.matchAll(/\b((?:19|20)\d{2})\s*(?:\+|onwards?|or\s+later|and\s+later|or\s+newer|and\s+newer)\b/gi),
    ...text.matchAll(/\b(?:from|since|after)\s+((?:19|20)\d{2})\b/gi),
    ...text.matchAll(/((?:19|20)\d{2})\s*年?\s*(?:以后|之后|以来|起|至今)/g),
  ];
  const years = matches
    .map((match) => Number(match[1]))
    .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2100);
  const relativeMatches = [
    ...text.matchAll(/\b(?:last|past|previous|recent)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/gi),
    ...text.matchAll(/(?:近|最近|过去)\s*(\d{1,2}|一|二|两|三|四|五|六|七|八|九|十)\s*年/g),
  ];
  const currentYear = new Date().getUTCFullYear();
  const relativeYears = relativeMatches
    .map((match) => parseCountWord(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 50)
    .map((yearCount) => currentYear - yearCount);
  const allYears = [...years, ...relativeYears];
  return allYears.length > 0 ? Math.max(...allYears) : undefined;
}

function cleanScopeName(value: string) {
  return value
    .replace(/[“”‘’"'`]/g, '')
    .replace(/\b(?:only|sheet|worksheet|tab|column|columns|field|fields|workbook|excel|data|dataset)\b/gi, '')
    .replace(/(?:工作表|表格|列|字段|数据|数据集|只|仅|只用|仅用|分析|使用)/g, '')
    .replace(/[.。,:：;；()[\]{}]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueScopeNames(values: string[]) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values.map(cleanScopeName).filter((name) => name.length >= 2 && name.length <= 60)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(value);
  }
  return names;
}

function splitColumnList(value: string) {
  return value
    .split(/[,，、/]|(?:\s+and\s+)/i)
    .map(cleanScopeName)
    .filter((name) => name && !/(?:^|\b)(?:q[1-4]|[12]\d{3}\s*q[1-4]|[12]\d{3}[-/]\d{1,2}[-/]\d{1,2})(?:\b|$)/i.test(name));
}

function quarterDateRange(year: number, quarter: number) {
  const starts = ['01-01', '04-01', '07-01', '10-01'];
  const ends = ['03-31', '06-30', '09-30', '12-31'];
  return {
    label: `${year} Q${quarter}`,
    start: `${year}-${starts[quarter - 1]}`,
    end: `${year}-${ends[quarter - 1]}`,
  };
}

function monthDateRange(year: number, startMonth: number, endMonth: number) {
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const end = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`;
  return {
    label: `${year}-${String(startMonth).padStart(2, '0')} to ${year}-${String(endMonth).padStart(2, '0')}`,
    start,
    end,
  };
}

function chineseQuarterToNumber(value: string) {
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4 };
  return map[value] || Number.parseInt(value, 10);
}

function englishMonthToNumber(value: string) {
  const map: Record<string, number> = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };
  return map[value.toLowerCase()] || 0;
}

function parseDataScopeRequirement(text: string): DataScopeRequirement | undefined {
  const sheetNames = [
    ...Array.from(text.matchAll(/\b(?:only|just|use only|analyse only|analyze only|from)\s+(?:the\s+)?["'`]?([A-Za-z0-9_. -]{2,60})["'`]?\s+(?:sheet|worksheet|tab)\b/gi)).map((match) => match[1] || ''),
    ...Array.from(text.matchAll(/\b(?:sheet|worksheet|tab)\s+["'`]?([A-Za-z0-9_. -]{2,60})["'`]?\s+(?:only|worksheet only|sheet only)\b/gi)).map((match) => match[1] || ''),
    ...Array.from(text.matchAll(/(?:只|仅)[^。！？\n]{0,12}(?:使用|用|分析)?\s*(?:工作表|sheet|表)\s*[“"'`]?([\u4e00-\u9fffA-Za-z0-9_. -]{2,60})[”"'`]?/gi)).map((match) => match[1] || ''),
  ];
  const columnNames = [
    ...Array.from(text.matchAll(/\b(?:only|just|use only|analyse only|analyze only)\s+(?:the\s+)?(?:columns?|fields?)\s+([A-Za-z0-9_,，、/ .-]{2,120})/gi)).flatMap((match) => splitColumnList(match[1] || '')),
    ...Array.from(text.matchAll(/\b(?:columns?|fields?)\s+["'`]([^"'`]{2,120})["'`]\s+(?:only|only\.)?/gi)).flatMap((match) => splitColumnList(match[1] || '')),
    ...Array.from(text.matchAll(/(?:只|仅)[^。！？\n]{0,12}(?:使用|用|分析)?\s*(?:列|字段)\s*[“"'`]?([\u4e00-\u9fffA-Za-z0-9_,，、/ .-]{2,120})[”"'`]?/gi)).flatMap((match) => splitColumnList(match[1] || '')),
  ];
  const groupNames = [
    ...Array.from(text.matchAll(/\b(?:only|just|use only|analyse only|analyze only|focus on)\s+(?:the\s+)?["'`]?([A-Za-z0-9_. -]{1,60})["'`]?\s+(?:group|segment|category|cohort)\b/gi)).map((match) => match[1] || ''),
    ...Array.from(text.matchAll(/\b(?:group|segment|category|cohort)\s+["'`]?([A-Za-z0-9_. -]{1,60})["'`]?\s+(?:only|only\.)\b/gi)).map((match) => match[1] || ''),
    ...Array.from(text.matchAll(/(?:只|仅)[^。！？\n]{0,12}(?:看|使用|用|分析|关注)?\s*[“"'`]?([\u4e00-\u9fffA-Za-z0-9_. -]{1,60})[”"'`]?\s*(?:组|分组|类别|人群|样本)/gi)).map((match) => match[1] || ''),
  ];

  let dateRange: DataScopeRequirement['dateRange'];
  const explicitDateRange = text.match(/\b(?:from|between)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(?:to|and|-)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b|(?:从|自)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:到|至|-)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
  if (explicitDateRange) {
    const start = (explicitDateRange[1] || explicitDateRange[3] || '').replace(/\//g, '-');
    const end = (explicitDateRange[2] || explicitDateRange[4] || '').replace(/\//g, '-');
    dateRange = { label: `${start} to ${end}`, start, end };
  } else {
    const quarterMatch = text.match(/\b(?:Q([1-4])\s*(20\d{2})|(20\d{2})\s*Q([1-4]))\b|(?:第([一二三四1-4])季度|Q([1-4]))\s*(20\d{2})/i);
    if (quarterMatch) {
      const quarter = Number.parseInt(quarterMatch[1] || quarterMatch[4] || '', 10)
        || chineseQuarterToNumber(quarterMatch[5] || quarterMatch[6] || '');
      const year = Number.parseInt(quarterMatch[2] || quarterMatch[3] || quarterMatch[7] || '', 10);
      if (quarter >= 1 && quarter <= 4 && year >= 1900 && year <= 2100) {
        dateRange = quarterDateRange(year, quarter);
      }
    } else {
      const englishMonthRange = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:to|through|until|-)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i);
      const chineseMonthRange = text.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*(?:月)?\s*(?:到|至|-)\s*(\d{1,2})\s*月/);
      if (englishMonthRange) {
        const startMonth = englishMonthToNumber(englishMonthRange[1] || '');
        const endMonth = englishMonthToNumber(englishMonthRange[2] || '');
        const year = Number.parseInt(englishMonthRange[3] || '', 10);
        if (startMonth >= 1 && endMonth >= startMonth && endMonth <= 12 && year >= 1900 && year <= 2100) {
          dateRange = monthDateRange(year, startMonth, endMonth);
        }
      } else if (chineseMonthRange) {
        const year = Number.parseInt(chineseMonthRange[1] || '', 10);
        const startMonth = Number.parseInt(chineseMonthRange[2] || '', 10);
        const endMonth = Number.parseInt(chineseMonthRange[3] || '', 10);
        if (startMonth >= 1 && endMonth >= startMonth && endMonth <= 12 && year >= 1900 && year <= 2100) {
          dateRange = monthDateRange(year, startMonth, endMonth);
        }
      }
    }
  }

  const dataScope = {
    requiredSheetNames: uniqueScopeNames(sheetNames),
    requiredColumnNames: uniqueScopeNames(columnNames),
    requiredGroupNames: uniqueScopeNames(groupNames),
    ...(dateRange ? { dateRange } : {}),
  };

  return dataScope.requiredSheetNames.length > 0
    || dataScope.requiredColumnNames.length > 0
    || dataScope.requiredGroupNames.length > 0
    || !!dataScope.dateRange
    ? dataScope
    : undefined;
}

function parseChartRequirement(text: string): ChartRequirement | undefined {
  const chartRequirement: ChartRequirement = {};
  const chartTypes: ChartRequirementType[] = [];
  const addChartType = (type: ChartRequirementType) => {
    if (!chartTypes.includes(type)) chartTypes.push(type);
  };

  if (/\bhistogram\b|直方图/i.test(text)) addChartType('histogram');
  if (/\bbox(?:\s|-)?(?:and(?:\s|-)?whisker\s*)?(?:plot|chart)?\b|箱线图|盒须图/i.test(text)) addChartType('boxplot');
  if (/\berror\s*bars?\b|误差线/i.test(text)) addChartType('errorbar');
  if (/\bdual[-\s]?axis\b|\btwo\s+y[-\s]?axes\b|双轴图|双纵轴/i.test(text)) addChartType('dual_axis');
  if (/\bscatter\s*(?:plot|chart|graph)?\b|散点图/i.test(text)) addChartType('scatter');
  if (/\bline\s*(?:chart|graph|plot)\b|折线图|曲线图/i.test(text)) addChartType('line');
  if (/\bbar\s*(?:chart|graph|plot)\b|柱状图|条形图/i.test(text)) addChartType('bar');
  if (/\bpie\s*(?:chart|graph)?\b|饼图/i.test(text)) addChartType('pie');
  if (chartTypes.length > 0) {
    chartRequirement.chartType = chartTypes[0];
    chartRequirement.chartTypes = chartTypes;
  }

  if (/\bflow\s*chart\b|\bflowchart\b|\bprocess\s+diagram\b|\bnodes?\b[^.。！？]{0,80}\barrows?\b|\barrows?\b[^.。！？]{0,80}\bnodes?\b|流程图|节点.*箭头|箭头.*节点/i.test(text)) {
    chartRequirement.requiresDiagram = true;
  }

  const xAxis = text.match(/\b(?:x[-\s]?axis|horizontal axis)\s*(?:is|as|=|:)?\s*["'`]?([A-Za-z0-9_. -]{2,60}?)(?:["'`]?(?=\s+(?:and\s+)?(?:y[-\s]?axis|vertical axis)\b|[.;,。！？\n]|$))/i)
    || text.match(/(?:横轴|x轴)\s*(?:为|是|用|=|:)?\s*[“"'`]?([\u4e00-\u9fffA-Za-z0-9_. -]{2,60}?)(?:[”"'`]?(?=\s*(?:，|,|。|；|;|和)?\s*(?:纵轴|y轴)|[。！？；;\n]|$))/i);
  if (xAxis) chartRequirement.xAxis = cleanScopeName(xAxis[1] || '');

  const yAxis = text.match(/\b(?:y[-\s]?axis|vertical axis)\s*(?:is|as|=|:)?\s*["'`]?([A-Za-z0-9_. -]{2,60}?)(?:["'`]?(?=\s+(?:and\s+)?(?:x[-\s]?axis|horizontal axis)\b|[.;,。！？\n]|$))/i)
    || text.match(/(?:纵轴|y轴)\s*(?:为|是|用|=|:)?\s*[“"'`]?([\u4e00-\u9fffA-Za-z0-9_. -]{2,60}?)(?:[”"'`]?(?=\s*(?:，|,|。|；|;|和)?\s*(?:横轴|x轴)|[。！？；;\n]|$))/i);
  if (yAxis) chartRequirement.yAxis = cleanScopeName(yAxis[1] || '');

  return chartRequirement.chartType || chartRequirement.xAxis || chartRequirement.yAxis || chartRequirement.requiresDiagram
    ? chartRequirement
    : undefined;
}

function parseUnsupportedDataOperations(text: string) {
  const operations: string[] = [];
  if (PIVOT_OPERATION_RE.test(text)) operations.push('pivot');
  if (JOIN_OPERATION_RE.test(text)) operations.push('join');
  if (LOOKUP_OPERATION_RE.test(text)) operations.push('lookup');
  if (MATRIX_OPERATION_RE.test(text)) operations.push('matrix');
  if (FILTER_OPERATION_RE.test(text)) operations.push('filter');
  return operations;
}

function decideProfessionalParameterHandling(text: string, requiresProfessionalParameters: boolean): ProfessionalParameterHandling {
  if (!requiresProfessionalParameters) {
    return { action: 'not_required', reasons: [] };
  }

  if (HIGH_RISK_PROFESSIONAL_RE.test(text) || HIGH_RISK_PROFESSIONAL_ALIAS_RE.test(text) || HIGH_RISK_PROFESSIONAL_EXTRA_RE.test(text) || HIGH_RISK_PROFESSIONAL_LOCAL_EXTRA_RE.test(text) || HIGH_RISK_PROFESSIONAL_EDGE_RE.test(text) || HIGH_RISK_PROFESSIONAL_SECOND_WAVE_RE.test(text) || HIGH_RISK_PROFESSIONAL_THIRD_WAVE_RE.test(text) || HIGH_RISK_PROFESSIONAL_FOURTH_WAVE_RE.test(text) || HIGH_RISK_PROFESSIONAL_FIFTH_WAVE_RE.test(text)) {
    return {
      action: 'high_level_schematic',
      reasons: ['high-risk legal, financial, chemical, or cybersecurity request must stay non-actionable'],
    };
  }

  if (WEB_BLOCKED_RE.test(text) || PRIVATE_HIGH_RISK_RE.test(text) || SOURCE_CONFLICT_RE.test(text) || INCOMPLETE_TECHNICAL_INPUT_RE.test(text)) {
    return {
      action: 'high_level_schematic',
      reasons: ['web lookup blocked or inappropriate for private/high-risk parameters'],
    };
  }

  return {
    action: 'web_lookup_first',
    reasons: ['professional figure is missing precise parameters and external lookup is not blocked'],
  };
}

export function assessWritingQualityRequirements(
  input: WritingQualityRequirementInput,
): WritingQualityRequirementProfile {
  const text = joinedTaskText(input);
  const files = input.materialFiles || [];
  const visualText = stripNegatedRequirementSegments(text, VISUAL_RE);
  const dataAnalysisText = stripNegatedRequirementSegments(text, DATA_ANALYSIS_RE);
  const originalDataAnalysisText = stripNegatedRequirementSegments(joinedOriginalTaskText(input), DATA_ANALYSIS_RE);
  const outlineDataAnalysisText = stripNegatedRequirementSegments(outlineTaskText(input), DATA_ANALYSIS_RE);
  const rubricText = stripNegatedRequirementSegments(text, RUBRIC_RE);
  const professionalText = stripNegatedRequirementSegments(text, PROFESSIONAL_RE);
  const documentElementText = stripNegatedRequirementSegments(text, DOCUMENT_ELEMENT_RE);
  const tableText = stripNegatedRequirementSegments(stripNegatedTableMentions(text).replace(TABLE_OF_CONTENTS_RE, ''), TABLE_RE);
  const highRiskProfessionalText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_RE);
  const highRiskProfessionalAliasText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_ALIAS_RE);
  const highRiskProfessionalExtraText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_EXTRA_RE);
  const highRiskProfessionalLocalExtraText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_LOCAL_EXTRA_RE);
  const highRiskProfessionalEdgeText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_EDGE_RE);
  const highRiskProfessionalSecondWaveText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_SECOND_WAVE_RE);
  const highRiskProfessionalThirdWaveText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_THIRD_WAVE_RE);
  const highRiskProfessionalFourthWaveText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_FOURTH_WAVE_RE);
  const highRiskProfessionalFifthWaveText = stripNegatedRequirementSegments(text, HIGH_RISK_PROFESSIONAL_FIFTH_WAVE_RE);
  const dataScope = parseDataScopeRequirement(text);
  const chartRequirement = parseChartRequirement(visualText);
  const requiredDocumentElements = parseRequiredDocumentElements(documentElementText);
  const requiredBodyHeadings = parseRequiredBodyHeadings(input.outline, text);
  const minimumReferenceYear = parseMinimumReferenceYear(text);
  const requiresPeerReviewedReferences = PEER_REVIEWED_REFERENCE_RE.test(text);
  const unsupportedDataOperations = parseUnsupportedDataOperations(dataAnalysisText);
  const { requiredVisualCount, maximumVisualCount } = deriveVisualRequirement(visualText);
  const requiresVisual = VISUAL_RE.test(visualText) || requiredVisualCount > 0;
  const requiresDataAnalysis = hasExplicitDataAnalysisRequest(originalDataAnalysisText)
    || hasOutlineDataAnalysisRequest(outlineDataAnalysisText)
    || (hasStructuredDataFile(files) && !DATA_ANALYSIS_NEGATED_RE.test(text));
  const requiresRubricReview = RUBRIC_RE.test(rubricText);
  const requiresProfessionalParameters = (PROFESSIONAL_RE.test(professionalText) && (PARAMETER_RE.test(professionalText) || VISUAL_RE.test(professionalText)))
    || HIGH_RISK_PROFESSIONAL_RE.test(highRiskProfessionalText)
    || HIGH_RISK_PROFESSIONAL_ALIAS_RE.test(highRiskProfessionalAliasText)
    || HIGH_RISK_PROFESSIONAL_EXTRA_RE.test(highRiskProfessionalExtraText)
    || HIGH_RISK_PROFESSIONAL_LOCAL_EXTRA_RE.test(highRiskProfessionalLocalExtraText)
    || HIGH_RISK_PROFESSIONAL_EDGE_RE.test(highRiskProfessionalEdgeText)
    || HIGH_RISK_PROFESSIONAL_SECOND_WAVE_RE.test(highRiskProfessionalSecondWaveText)
    || HIGH_RISK_PROFESSIONAL_THIRD_WAVE_RE.test(highRiskProfessionalThirdWaveText)
    || HIGH_RISK_PROFESSIONAL_EDGE_RE.test(text)
    || HIGH_RISK_PROFESSIONAL_SECOND_WAVE_RE.test(text)
    || HIGH_RISK_PROFESSIONAL_THIRD_WAVE_RE.test(text)
    || HIGH_RISK_PROFESSIONAL_FOURTH_WAVE_RE.test(highRiskProfessionalFourthWaveText)
    || HIGH_RISK_PROFESSIONAL_FOURTH_WAVE_RE.test(text)
    || HIGH_RISK_PROFESSIONAL_FIFTH_WAVE_RE.test(highRiskProfessionalFifthWaveText)
    || HIGH_RISK_PROFESSIONAL_FIFTH_WAVE_RE.test(text);
  const requiresTable = TABLE_RE.test(tableText) && !TABLE_OF_CONTENTS_RE.test(tableText);
  const prohibitsVisuals = PROHIBIT_VISUAL_RE.test(text);
  const prohibitsBulletLists = PROHIBIT_BULLET_LIST_RE.test(text);
  const prohibitsFirstPerson = PROHIBIT_FIRST_PERSON_RE.test(text);
  const externalSourcesAllowed = !WEB_BLOCKED_RE.test(text);
  const signals: string[] = [];

  if (requiresVisual) signals.push('visual_required');
  if (requiresDataAnalysis) signals.push('data_analysis_required');
  if (requiresRubricReview) signals.push('rubric_review_required');
  if (requiresProfessionalParameters) signals.push('professional_parameters_required');
  if (requiresTable) signals.push('table_required');
  if (prohibitsVisuals) signals.push('visuals_prohibited');
  if (prohibitsBulletLists) signals.push('bullet_lists_prohibited');
  if (prohibitsFirstPerson) signals.push('first_person_prohibited');
  if (!externalSourcesAllowed) signals.push('external_sources_blocked');
  if (dataScope) signals.push('data_scope_required');
  if (chartRequirement) signals.push('chart_spec_required');
  if (unsupportedDataOperations.length > 0) signals.push('unsupported_data_operation_required');
  if (requiredDocumentElements.length > 0) signals.push('document_elements_required');
  if (requiredBodyHeadings.length > 0) signals.push('body_heading_order_required');
  if (minimumReferenceYear !== undefined) signals.push('reference_year_required');
  if (requiresPeerReviewedReferences) signals.push('peer_reviewed_references_required');

  return {
    requiresVisual,
    requiresDataAnalysis,
    requiresRubricReview,
    requiresProfessionalParameters,
    requiresTable,
    prohibitsVisuals,
    prohibitsBulletLists,
    prohibitsFirstPerson,
    externalSourcesAllowed,
    requiredVisualCount,
    maximumVisualCount,
    requiredDocumentElements,
    requiredBodyHeadings,
    ...(minimumReferenceYear !== undefined ? { minimumReferenceYear } : {}),
    requiresPeerReviewedReferences,
    ...(chartRequirement ? { chartRequirement } : {}),
    ...(dataScope ? { dataScope } : {}),
    unsupportedDataOperations,
    parameterHandling: decideProfessionalParameterHandling(text, requiresProfessionalParameters),
    signals,
  };
}

function chartPlaceholders(chartText: string) {
  return Array.from(new Set(String(chartText || '').match(CHART_PLACEHOLDER_RE) || []));
}

function countSuccessfulVisuals(chartText: string, mediaMap: Map<string, RenderedChart>) {
  return chartPlaceholders(chartText).filter((placeholder) => {
    const rendered = mediaMap.get(placeholder);
    return !!rendered?.png && rendered.png.length > 0;
  }).length;
}

function stripLeadingTitleLine(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 0 && !lines[0]!.trim()) {
    lines.shift();
  }

  const firstLine = lines[0]?.trim() || '';
  const nextNonEmptyLine = lines.slice(1).find((line) => line.trim())?.trim() || '';
  const looksLikeTitle = !!firstLine
    && firstLine.length <= 160
    && firstLine.split(/\s+/).length <= 25
    && !/[.?!]$/.test(firstLine)
    && !/\((19|20)\d{2}[a-z]?\)/.test(firstLine)
    && !!nextNonEmptyLine;

  if (looksLikeTitle) {
    lines.shift();
  }

  return lines.join('\n').trim();
}

function extractMainBodyText(text: string) {
  const withoutTitle = stripLeadingTitleLine(String(text || '').trim());
  const lines = withoutTitle.replace(/\r\n/g, '\n').split('\n');
  const mainBodyEndIndex = lines.findIndex((line) => {
    const heading = line.trim();
    return REFERENCE_HEADING_RE.test(heading) || APPENDIX_HEADING_RE.test(heading);
  });
  return (mainBodyEndIndex >= 0 ? lines.slice(0, mainBodyEndIndex) : lines).join('\n').trim();
}

function countMainBodyWordsForGate(text: string) {
  return extractMainBodyText(text)
    .replace(/\[CHART_BEGIN\][\s\S]*?\[CHART_END\]/g, '')
    .replace(/^\|[^\n]*\|$/gm, '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .length;
}

function isWordCountWithinRange(text: string, targetWords?: number) {
  if (!targetWords) return true;
  const minWords = Math.floor(targetWords * 0.9);
  const maxWords = Math.ceil(targetWords * 1.1);
  const actualWords = countMainBodyWordsForGate(text);
  return actualWords >= minWords && actualWords <= maxWords;
}

function hasEnoughBodySections(text: string, requiredSectionCount?: number) {
  if (!requiredSectionCount) return true;
  return extractBodyHeadingLines(text).length >= requiredSectionCount;
}

function hasMarkdownTable(text: string) {
  const lines = extractMainBodyText(text).replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index]!.trim();
    const next = lines[index + 1]!.trim();
    if (/^\|.+\|$/.test(current) && /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(next)) {
      return true;
    }
  }
  return false;
}

function hasBulletOrNumberedList(text: string) {
  return extractMainBodyText(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .some((line) => /^\s*(?:[-*•]\s+|\d{1,2}[.)]\s+)\S/.test(line));
}

function hasFirstPersonUsage(text: string) {
  const body = extractMainBodyText(text)
    .replace(/\([^)]*(?:19|20)\d{2}[^)]*\)/g, '')
    .replace(/\[[^\]]+\]/g, '');
  return /\b(?:I|we|We|our|Our|ours|Ours|my|My|mine|Mine|me|Me|us|Us)\b|我(?:们)?|本人|笔者/.test(body);
}

function normalizeHeadingLine(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+(?:\.\d+)*[.)]?\s*/, '')
    .replace(/[:：]\s*$/g, '')
    .trim();
}

function headingMatchesDocumentElement(heading: string, element: RequiredDocumentElement) {
  if (element === 'introduction') return /^(introduction|引言|导论)\b/i.test(heading);
  if (element === 'abstract') return /^(abstract|摘要)\b/i.test(heading);
  if (element === 'table_of_contents') return /^(table of contents|contents|目录)\b/i.test(heading);
  if (element === 'appendix') return /^(appendix(?:\s+[A-Z0-9一二三四五六七八九十]+)?|appendices|附录(?:\s*[A-Z0-9一二三四五六七八九十]+)?)\b/i.test(heading);
  if (element === 'executive_summary') return /^(executive summary|执行摘要)\b/i.test(heading);
  if (element === 'policy_options') return /^(policy options?|options?|policy alternatives?|政策选项|方案选项)\b/i.test(heading);
  if (element === 'recommendation') return /^(recommendations?|recommended option|建议|政策建议|推荐方案)\b/i.test(heading);
  if (element === 'literature_review') return /^(literature review|文献综述)\b/i.test(heading);
  if (element === 'methodology') return /^(methodolog(?:y|ies)|methods?|方法论|研究方法)\b/i.test(heading);
  if (element === 'results') return /^(results?|结果)\b/i.test(heading);
  if (element === 'discussion') return /^(discussion|讨论)\b/i.test(heading);
  if (element === 'conclusion') return /^(conclusion|结论)\b/i.test(heading);
  return false;
}

function hasDocumentElementHeading(text: string, element: RequiredDocumentElement) {
  const headings = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeHeadingLine)
    .filter(Boolean);

  return headings.some((heading) => headingMatchesDocumentElement(heading, element));
}

function hasAllRequiredDocumentElements(text: string, elements: RequiredDocumentElement[]) {
  return elements.every((element) => hasDocumentElementHeading(text, element));
}

function hasRequiredDocumentElementsInOrder(text: string, elements: RequiredDocumentElement[]) {
  if (!elements.includes('policy_options') && !elements.includes('recommendation')) {
    return true;
  }

  const headings = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeHeadingLine)
    .filter(Boolean);
  let searchFrom = 0;

  for (const element of elements) {
    const foundIndex = headings
      .slice(searchFrom)
      .findIndex((heading) => headingMatchesDocumentElement(heading, element));
    if (foundIndex < 0) {
      return false;
    }
    searchFrom += foundIndex + 1;
  }

  return true;
}

function hasPopulatedTableOfContents(text: string, elements: RequiredDocumentElement[]) {
  if (!elements.includes('table_of_contents')) return true;

  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const tocIndex = lines.findIndex((line) => headingMatchesDocumentElement(normalizeHeadingLine(line), 'table_of_contents'));
  if (tocIndex < 0) return false;

  const entries: string[] = [];
  for (const line of lines.slice(tocIndex + 1)) {
    const entry = normalizeHeadingLine(line);
    if (!entry) break;
    if (headingMatchesDocumentElement(entry, 'abstract') || headingMatchesDocumentElement(entry, 'appendix')) break;
    if (/^(references|reference list|bibliography|works cited|参考文献|引用文献)\b/i.test(entry)) break;
    entries.push(entry);
    if (entries.length >= 2) return true;
  }

  return false;
}

const DOCUMENT_CONTENT_ELEMENTS: RequiredDocumentElement[] = [
  'introduction',
  'abstract',
  'appendix',
  'executive_summary',
  'policy_options',
  'recommendation',
  'literature_review',
  'methodology',
  'results',
  'discussion',
  'conclusion',
];

function isSectionBreakLine(line: string, extraHeadings: string[] = []) {
  const normalized = normalizeHeadingLine(line);
  if (!normalized) return false;
  return REFERENCE_HEADING_RE.test(normalized)
    || DOCUMENT_CONTENT_ELEMENTS.some((candidate) => headingMatchesDocumentElement(normalized, candidate))
    || extraHeadings.some((heading) => matchesRequiredScopeName(normalized, heading));
}

function sectionContentAfterHeading(lines: string[], headingIndex: number, extraHeadings: string[] = []) {
  const contentLines: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (isSectionBreakLine(line, extraHeadings)) {
      break;
    }
    contentLines.push(line);
  }
  return contentLines.join(' ');
}

function strippedSectionContent(content: string) {
  return content
    .replace(/\([^)]*(?:19|20)\d{2}[^)]*\)/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function requiredDocumentElementsWithEmptyContent(text: string, elements: RequiredDocumentElement[]) {
  const contentElements = elements.filter((element) => element !== 'table_of_contents');
  if (contentElements.length === 0) return [];

  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const emptyElements: RequiredDocumentElement[] = [];

  for (const element of contentElements) {
    const headingIndex = lines.findIndex((line) => headingMatchesDocumentElement(normalizeHeadingLine(line), element));
    if (headingIndex < 0) continue;

    const content = strippedSectionContent(sectionContentAfterHeading(lines, headingIndex));
    if (content.length < 12) {
      emptyElements.push(element);
    }
  }

  return emptyElements;
}

function requiredDocumentElementsWithPlaceholderContent(text: string, elements: RequiredDocumentElement[]) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  return elements
    .filter((element) => element !== 'table_of_contents')
    .some((element) => {
      const headingIndex = lines.findIndex((line) => headingMatchesDocumentElement(normalizeHeadingLine(line), element));
      if (headingIndex < 0) return false;
      return PLACEHOLDER_CONTENT_RE.test(sectionContentAfterHeading(lines, headingIndex));
    });
}

function requiredBodyHeadingsWithEmptyContent(text: string, requiredHeadings: string[]) {
  if (requiredHeadings.length === 0) return [];

  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const emptyHeadings: string[] = [];
  for (const heading of requiredHeadings) {
    const headingIndex = lines.findIndex((line) => matchesRequiredScopeName(normalizeHeadingLine(line), heading));
    if (headingIndex < 0) continue;
    const content = strippedSectionContent(sectionContentAfterHeading(lines, headingIndex, requiredHeadings));
    if (content.length < 12) emptyHeadings.push(heading);
  }
  return emptyHeadings;
}

function hasExternalSourceViolation(text: string, externalSourcesAllowed: boolean) {
  if (externalSourcesAllowed) return false;
  if (EXTERNAL_REFERENCE_RE.test(text)) return true;
  const references = summarizeReferenceCompliance(text).referenceEntries;
  return references.some((entry) => EXTERNAL_REFERENCE_RE.test(entry));
}

function hasUnsupportedDataClaim(text: string, dataAnalysis: StructuredDataAnalysisResult) {
  if (dataAnalysis.status !== 'completed') return false;
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .filter(Boolean)
    .some((sentence) => DATA_METHOD_CLAIM_RE.test(sentence) && !isUnsupportedDataLimitation(sentence));
}

function isUnsupportedDataLimitation(sentence: string) {
  return /\b(?:do\s+not|does\s+not|did\s+not|not|no|without|cannot|can't|cant|should\s+not|must\s+not)\b[^.。！？]{0,120}\b(?:regression|anova|t-test|chi-square|statistically significant|p\s*-?\s*values?|p\s*[<=>]\s*0?\.\d+|causal|causation|correlation coefficient|pearson(?:'s)?(?:\s+(?:r|correlation))?|spearman(?:'s)?(?:\s+(?:rho|correlation))?|rho\s*=\s*-?\d|beta coefficient|odds ratios?|risk ratios?|relative risk|sensitivity|specificity|prevalence|incidence|kaplan-?meier|cox model|roc|auc|fixed effects?|difference-in-differences|instrumental variable|r\^?2|confidence intervals?|(?:95%\s*)?ci)\b|\b(?:descriptive|summary|limited)\b[^.。！？]{0,120}\b(?:does\s+not|cannot|without|no)\b|不(?:做|进行|报告|声称|证明|代表)[^.。！？]{0,120}(?:回归|显著|p\s*值|p值|因果|相关系数)|仅(?:描述|汇总)[^.。！？]{0,120}(?:不|不能)/i.test(sentence);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numericValuesInText(value: string) {
  return Array.from(value.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)).map((match) => Number(match[0]));
}

function roughlyEqual(a: number, b: number) {
  return Math.abs(a - b) <= 0.01;
}

function numberMatchesMetric(sentence: string, value: number, expected: number) {
  if (roughlyEqual(value, expected)) return true;
  if (/%|\bpercent(?:age)?\b|百分比/.test(sentence) && roughlyEqual(value / 100, expected)) return true;
  return false;
}

type MetricKind = 'mean' | 'min' | 'max' | 'median' | 'standardDeviation' | 'total' | 'count';

const METRIC_LABEL_SOURCES: Record<MetricKind, string> = {
  mean: String.raw`\b(?:mean|average)\b|平均|均值`,
  min: String.raw`\b(?:min|minimum)\b|最小`,
  max: String.raw`\b(?:max|maximum)\b|最大`,
  median: String.raw`\bmedian\b|中位数`,
  standardDeviation: String.raw`\b(?:standard deviation|std\.?\s*dev\.?|sd)\b|标准差`,
  total: String.raw`\b(?:total|sum)\b|总和|总计|合计`,
  count: String.raw`\b(?:count|number of|rows?|records?|observations?)\b|数量|总数|行数|记录数`,
};

function collectMetricLabels(sentence: string) {
  const labels: Array<{ kind: MetricKind; start: number; end: number }> = [];
  for (const [kind, source] of Object.entries(METRIC_LABEL_SOURCES) as Array<[MetricKind, string]>) {
    for (const match of sentence.matchAll(new RegExp(source, 'gi'))) {
      labels.push({ kind, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
    }
  }
  return labels.sort((a, b) => a.start - b.start || b.end - a.end);
}

function metricWindowNumbers(sentence: string, kind: MetricKind) {
  const labels = collectMetricLabels(sentence);
  const numbers: number[] = [];
  labels.forEach((label, index) => {
    if (label.kind !== kind) return;
    const nextLabel = labels.slice(index + 1).find((candidate) => candidate.start > label.start);
    const segment = sentence.slice(label.start, nextLabel?.start ?? sentence.length);
    numbers.push(...numericValuesInText(segment));
  });
  return numbers;
}

function hasMetricValueMismatch(
  sentence: string,
  kind: MetricKind,
  expectedValues: number[],
  matcher: (value: number, expected: number) => boolean = (value, expected) => numberMatchesMetric(sentence, value, expected),
) {
  const numbers = metricWindowNumbers(sentence, kind);
  if (numbers.length === 0) return false;
  return !numbers.some((value) => expectedValues.some((expected) => matcher(value, expected)));
}

function hasMetricNumber(sentence: string, expected: number) {
  return numericValuesInText(sentence).some((value) => numberMatchesMetric(sentence, value, expected));
}

function columnLabelMatches(sentence: string, column: string) {
  const columnLabel = column.split(':').pop() || column;
  return looseLabelMatches(sentence, columnLabel);
}

function textLabelMatches(sentence: string, label: string) {
  return looseLabelMatches(sentence, label);
}

function looseLabelMatches(text: string, label: string) {
  const normalizedText = text.toLowerCase();
  const normalizedLabel = label.toLowerCase();
  if (/^[a-z0-9_. -]+$/i.test(label)) {
    return new RegExp(`\\b${escapeRegExp(label)}\\b`, 'i').test(text);
  }
  return normalizedText.includes(normalizedLabel);
}

function sentenceHasGroupedContext(sentence: string, column: string, dataAnalysis: Extract<StructuredDataAnalysisResult, { status: 'completed' }>) {
  return Object.values(dataAnalysis.groupedNumericColumns || {}).some((summary) => (
    summary.valueColumn === column
    || summary.valueColumn.split(':').pop() === column.split(':').pop()
  ) && Object.keys(summary.groups).some((group) => textLabelMatches(sentence, group)));
}

function numericSummarySum(summary: { count: number; mean: number; sum?: number }) {
  return typeof summary.sum === 'number' && Number.isFinite(summary.sum)
    ? summary.sum
    : summary.mean * summary.count;
}

function normalizedDate(value: string) {
  const match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return value.replace(/\//g, '-');
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function hasMismatchedDataMetricClaim(text: string, dataAnalysis: StructuredDataAnalysisResult) {
  if (dataAnalysis.status !== 'completed') return false;

  const sentences = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  const numericColumnCount = Object.keys(dataAnalysis.numericColumns).length;
  for (const [column, summary] of Object.entries(dataAnalysis.numericColumns)) {
    for (const sentence of sentences) {
      if (!columnLabelMatches(sentence, column) && numericColumnCount !== 1) continue;
      if (sentenceHasGroupedContext(sentence, column, dataAnalysis)) continue;
      if (/\bweighted\b|加权/i.test(sentence)) continue;
      if (/\b(ratio|rate|conversion)\b|转化率|比率/i.test(sentence)) continue;
      if (hasMetricValueMismatch(sentence, 'mean', [summary.mean], (value, expected) => roughlyEqual(value, expected))) {
        return true;
      }

      if (hasMetricValueMismatch(sentence, 'min', [summary.min], (value, expected) => roughlyEqual(value, expected))) {
        return true;
      }

      if (hasMetricValueMismatch(sentence, 'max', [summary.max], (value, expected) => roughlyEqual(value, expected))) {
        return true;
      }

      if (summary.median !== undefined
        && hasMetricValueMismatch(sentence, 'median', [summary.median], (value, expected) => roughlyEqual(value, expected))) {
        return true;
      }

      if (summary.standardDeviation !== undefined
        && hasMetricValueMismatch(sentence, 'standardDeviation', [summary.standardDeviation], (value, expected) => roughlyEqual(value, expected))) {
        return true;
      }

      if (hasMetricValueMismatch(sentence, 'total', [numericSummarySum(summary)])) {
        return true;
      }

      if (hasMetricValueMismatch(sentence, 'count', [summary.count, dataAnalysis.rowCount], (value, expected) => roughlyEqual(value, expected))) {
        return true;
      }
    }
  }

  for (const summary of Object.values(dataAnalysis.groupedNumericColumns || {})) {
    for (const [group, groupSummary] of Object.entries(summary.groups)) {
      for (const sentence of sentences) {
        if (!columnLabelMatches(sentence, summary.valueColumn) || !textLabelMatches(sentence, group)) continue;
        if (hasMetricValueMismatch(sentence, 'mean', [groupSummary.mean])) {
          return true;
        }

        if (hasMetricValueMismatch(sentence, 'total', [numericSummarySum(groupSummary)])) {
          return true;
        }

        if (hasMetricValueMismatch(sentence, 'count', [groupSummary.count], (value, expected) => roughlyEqual(value, expected))) {
          return true;
        }
      }
    }
  }

  for (const summary of dataAnalysis.weightedAverages || []) {
    for (const sentence of sentences) {
      if (!/\bweighted\b|加权/i.test(sentence)) continue;
      if (!columnLabelMatches(sentence, summary.valueColumn)) continue;
      const numbers = numericValuesInText(sentence);
      if (numbers.length > 0 && !numbers.some((value) => numberMatchesMetric(sentence, value, summary.weightedMean))) {
        return true;
      }
    }
  }

  for (const summary of dataAnalysis.ratioMetrics || []) {
    for (const sentence of sentences) {
      const mentionsRatio = /\b(ratio|rate|conversion)\b|转化率|比率/i.test(sentence)
        || columnLabelMatches(sentence, summary.numeratorColumn)
        || columnLabelMatches(sentence, summary.denominatorColumn);
      if (!mentionsRatio) continue;
      const numbers = numericValuesInText(sentence);
      const percentNumbers = Array.from(sentence.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:%|\bpercent(?:age)?\b)/gi))
        .map((match) => Number(match[1]));
      if (/\b(ratio|rate|conversion)\b|转化率|比率/i.test(sentence)
        && ((percentNumbers.length > 0
          && !percentNumbers.some((value) => roughlyEqual(value / 100, summary.ratio.mean)))
          || (percentNumbers.length === 0
            && numbers.length > 0
            && !numbers.some((value) => roughlyEqual(value, summary.ratio.mean))))) {
        return true;
      }
      if (summary.zeroDenominatorRows > 0
        && /\bzero\s+denominators?\b|分母.*0|零分母/i.test(sentence)
        && numbers.length > 0
        && !numbers.some((value) => roughlyEqual(value, summary.zeroDenominatorRows))) {
        return true;
      }
    }
  }

  const dateColumnCount = Object.keys(dataAnalysis.dateColumns || {}).length;
  for (const [column, summary] of Object.entries(dataAnalysis.dateColumns || {})) {
    for (const sentence of sentences) {
      if (!columnLabelMatches(sentence, column) && dateColumnCount !== 1) continue;
      const dates = Array.from(sentence.matchAll(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)).map((match) => normalizedDate(match[0]!));
      if (/\b(date range|range|from|between)\b|日期范围|从.*到/i.test(sentence)
        && dates.length >= 2
        && (!dates.includes(summary.min) || !dates.includes(summary.max))) {
        return true;
      }
      if (/\b(earliest|first|start(?:ing)?|minimum|min)\b|最早|起始|开始/i.test(sentence)
        && dates.length > 0
        && !dates.includes(summary.min)) {
        return true;
      }
      if (/\b(latest|last|end(?:ing)?|maximum|max)\b|最晚|最后|结束/i.test(sentence)
        && dates.length > 0
        && !dates.includes(summary.max)) {
        return true;
      }
    }
  }

  for (const [column, count] of Object.entries(dataAnalysis.missingValues)) {
    for (const sentence of sentences) {
      if (!columnLabelMatches(sentence, column)) continue;
      if (!/\bmissing\b|缺失|空值/i.test(sentence)) continue;
      const numbers = numericValuesInText(sentence);
      if (numbers.length > 0 && !numbers.some((value) => roughlyEqual(value, count))) {
        return true;
      }
    }
  }

  return false;
}

function chartNumbers(rendered: RenderedChart) {
  const datasets = Array.isArray(rendered.spec.chartjs?.data?.datasets)
    ? rendered.spec.chartjs.data.datasets
    : [];
  const values: number[] = [];

  for (const dataset of datasets) {
    const data = Array.isArray(dataset?.data) ? dataset.data : [];
    for (const point of data) {
      if (typeof point === 'number' && Number.isFinite(point)) {
        values.push(point);
      } else if (point && typeof point === 'object') {
        for (const value of Object.values(point as Record<string, unknown>)) {
          if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
        }
      }
    }
  }

  return values;
}

function chartLabels(rendered: RenderedChart) {
  const labels: unknown[] = Array.isArray(rendered.spec.chartjs?.data?.labels)
    ? rendered.spec.chartjs.data.labels
    : [];
  return labels.map((label) => String(label || '').trim());
}

function numericChartPoint(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const point = value as Record<string, unknown>;
    if (typeof point.y === 'number' && Number.isFinite(point.y)) return point.y;
    if (typeof point.x === 'number' && Number.isFinite(point.x)) return point.x;
  }
  return null;
}

function chartDatasetSeries(rendered: RenderedChart) {
  const datasets = Array.isArray(rendered.spec.chartjs?.data?.datasets)
    ? rendered.spec.chartjs.data.datasets
    : [];
  return datasets.map((dataset: any) => ({
    label: String(dataset?.label || ''),
    values: Array.isArray(dataset?.data)
      ? dataset.data.map(numericChartPoint)
      : [],
  }));
}

function chartSearchText(rendered: RenderedChart) {
  const labels = Array.isArray(rendered.spec.chartjs?.data?.labels)
    ? rendered.spec.chartjs.data.labels.join(' ')
    : '';
  const datasetLabels = Array.isArray(rendered.spec.chartjs?.data?.datasets)
    ? rendered.spec.chartjs.data.datasets.map((dataset: any) => dataset?.label || '').join(' ')
    : '';
  return `${rendered.spec.title || ''} ${labels} ${datasetLabels}`;
}

function textLooksLikeGroupComparison(text: string) {
  return /\b(?:compare|comparison|compared|by|across|between|group|groups|segment|segments|category|categories|cohort|channel)\b|比较|对比|分组|按.*(?:组|类别|渠道|人群)/i.test(text);
}

function chartValueMatchesAnyCoreMetric(text: string, value: number, summary: { count: number; min: number; max: number; mean: number; median?: number; standardDeviation?: number; sum?: number }) {
  return numberMatchesMetric(text, value, summary.mean)
    || numberMatchesMetric(text, value, numericSummarySum(summary))
    || roughlyEqual(value, summary.count)
    || roughlyEqual(value, summary.min)
    || roughlyEqual(value, summary.max)
    || (summary.median !== undefined && numberMatchesMetric(text, value, summary.median))
    || (summary.standardDeviation !== undefined && numberMatchesMetric(text, value, summary.standardDeviation));
}

function hasMismatchedChartMetric(mediaMap: Map<string, RenderedChart>, dataAnalysis: StructuredDataAnalysisResult) {
  if (dataAnalysis.status !== 'completed') return false;

  const numericColumnCount = Object.keys(dataAnalysis.numericColumns).length;
  for (const rendered of mediaMap.values()) {
    if (!rendered.png) continue;
    const text = chartSearchText(rendered);
    const values = chartNumbers(rendered);
    if (values.length === 0) continue;

    for (const summary of Object.values(dataAnalysis.groupedNumericColumns || {})) {
      if (!scopeLabelVariants(summary.valueColumn).some((valueColumn) => looseLabelMatches(text, valueColumn))) continue;
      const groupNames = Object.keys(summary.groups);
      const presentGroups = groupNames.filter((group) => scopeLabelVariants(group).some((groupName) => looseLabelMatches(text, groupName)));
      if (textLooksLikeGroupComparison(text) && presentGroups.length > 0 && presentGroups.length < groupNames.length) {
        return true;
      }

      const labels = chartLabels(rendered);
      const series = chartDatasetSeries(rendered);
      for (const [group, groupSummary] of Object.entries(summary.groups)) {
        const labelIndex = labels.findIndex((label) => scopeLabelVariants(group).some((groupName) => looseLabelMatches(label, groupName)));
        if (labelIndex < 0) continue;
        for (const dataset of series) {
          const value = dataset.values[labelIndex];
          if (value === null || value === undefined) continue;
          const datasetText = `${text} ${dataset.label}`;
          if (/\b(mean|average)\b|平均|均值/i.test(datasetText)
            && !numberMatchesMetric(datasetText, value, groupSummary.mean)) {
            return true;
          }
          if (/\b(total|sum)\b|总和|总计|合计/i.test(datasetText)
            && !numberMatchesMetric(datasetText, value, numericSummarySum(groupSummary))) {
            return true;
          }
          if (/\b(count|number of|rows?|records?|observations?)\b|数量|总数|行数|记录数/i.test(datasetText)
            && !roughlyEqual(value, groupSummary.count)) {
            return true;
          }
          if (!/\b(mean|average|total|sum|count|number of|rows?|records?|observations?|min|minimum|max|maximum|median|standard deviation|std\.?\s*dev\.?|sd)\b|平均|均值|总和|总计|合计|数量|总数|行数|记录数|最大|最小|中位数|标准差/i.test(datasetText)
            && textLooksLikeGroupComparison(datasetText)
            && !chartValueMatchesAnyCoreMetric(datasetText, value, groupSummary)) {
            return true;
          }
        }
      }

      for (const [group, groupSummary] of Object.entries(summary.groups)) {
        if (!scopeLabelVariants(group).some((groupName) => looseLabelMatches(text, groupName))) continue;

        if (/\b(mean|average)\b|平均|均值/i.test(text)
          && !values.some((value) => numberMatchesMetric(text, value, groupSummary.mean))) {
          return true;
        }

        if (/\b(min|minimum)\b|最小/i.test(text)
          && !values.some((value) => numberMatchesMetric(text, value, groupSummary.min))) {
          return true;
        }

        if (/\b(max|maximum)\b|最大/i.test(text)
          && !values.some((value) => numberMatchesMetric(text, value, groupSummary.max))) {
          return true;
        }

        if (groupSummary.median !== undefined
          && /\bmedian\b|中位数/i.test(text)
          && !values.some((value) => numberMatchesMetric(text, value, groupSummary.median!))) {
          return true;
        }

        if (groupSummary.standardDeviation !== undefined
          && /\b(standard deviation|std\.?\s*dev\.?|sd)\b|标准差/i.test(text)
          && !values.some((value) => numberMatchesMetric(text, value, groupSummary.standardDeviation!))) {
          return true;
        }

        if (/\b(total|sum)\b|总和|总计|合计/i.test(text)
          && !values.some((value) => numberMatchesMetric(text, value, numericSummarySum(groupSummary)))) {
          return true;
        }

        if (/\b(count|number of|rows?|records?|observations?)\b|数量|总数|行数|记录数/i.test(text)
          && !values.some((value) => roughlyEqual(value, groupSummary.count))) {
          return true;
        }
      }
    }

    for (const [column, summary] of Object.entries(dataAnalysis.numericColumns)) {
      if (!columnLabelMatches(text, column) && numericColumnCount !== 1) continue;

      if (/\b(mean|average)\b|平均|均值/i.test(text)
        && !values.some((value) => numberMatchesMetric(text, value, summary.mean))) {
        return true;
      }

      if (/\b(min|minimum)\b|最小/i.test(text)
        && !values.some((value) => numberMatchesMetric(text, value, summary.min))) {
        return true;
      }

      if (/\b(max|maximum)\b|最大/i.test(text)
        && !values.some((value) => numberMatchesMetric(text, value, summary.max))) {
        return true;
      }

      if (summary.median !== undefined
        && /\bmedian\b|中位数/i.test(text)
        && !values.some((value) => numberMatchesMetric(text, value, summary.median!))) {
        return true;
      }

      if (summary.standardDeviation !== undefined
        && /\b(standard deviation|std\.?\s*dev\.?|sd)\b|标准差/i.test(text)
        && !values.some((value) => numberMatchesMetric(text, value, summary.standardDeviation!))) {
        return true;
      }

      if (/\b(total|sum)\b|总和|总计|合计/i.test(text)
        && !values.some((value) => numberMatchesMetric(text, value, numericSummarySum(summary)))) {
        return true;
      }

      if (/\b(count|number of|rows?|records?|observations?)\b|数量|总数|行数|记录数/i.test(text)
        && !values.some((value) => roughlyEqual(value, summary.count) || roughlyEqual(value, dataAnalysis.rowCount))) {
        return true;
      }
    }
  }

  return false;
}

function chartAxisTitle(rendered: RenderedChart, axis: 'x' | 'y') {
  return String(rendered.spec.chartjs?.options?.scales?.[axis]?.title?.text || '').trim();
}

function chartDatasetLabels(rendered: RenderedChart): string[] {
  return Array.isArray(rendered.spec.chartjs?.data?.datasets)
    ? rendered.spec.chartjs.data.datasets.map((dataset: any) => String(dataset?.label || '').trim()).filter(Boolean)
    : [];
}

function chartTextAroundPlaceholder(chartText: string, placeholder: string) {
  const text = extractMainBodyText(chartText);
  const index = text.indexOf(placeholder);
  if (index < 0) return text;
  return text.slice(Math.max(0, index - 260), Math.min(text.length, index + placeholder.length + 260));
}

function hasNumberedChartTitle(rendered: RenderedChart) {
  return /^(?:figure|fig\.?|chart)\s*\d+\s*[:：-]\s*\S/i.test(rendered.spec.title || '')
    || /^图\s*\d+\s*[:：-]\s*\S/i.test(rendered.spec.title || '');
}

function hasBodyReferenceForChart(chartText: string, placeholder: string, rendered: RenderedChart) {
  const nearby = chartTextAroundPlaceholder(chartText, placeholder);
  const titleNumber = String(rendered.spec.title || '').match(/(?:figure|fig\.?|chart)\s*(\d+)|图\s*(\d+)/i);
  const number = titleNumber?.[1] || titleNumber?.[2];

  if (number) {
    const numberedReference = new RegExp(`\\b(?:figure|fig\\.?|chart)\\s*${escapeRegExp(number)}\\b|图\\s*${escapeRegExp(number)}\\b`, 'i');
    if (numberedReference.test(nearby)) return true;
  }

  return /\b(?:as shown|shown below|as illustrated|illustrates|demonstrates|depicts|visuali[sz]es|summari[sz]es)\b|如图|如下图|图中|图表显示|图表说明/i.test(nearby);
}

function hasRequiredChartCaptionAndBodyReference(chartText: string, mediaMap: Map<string, RenderedChart>) {
  for (const placeholder of chartPlaceholders(chartText)) {
    const rendered = mediaMap.get(placeholder);
    if (!rendered?.png) continue;
    if (!hasNumberedChartTitle(rendered)) return false;
    if (!hasBodyReferenceForChart(chartText, placeholder, rendered)) return false;
  }
  return true;
}

function renderedVisualSafetyText(mediaMap: Map<string, RenderedChart>) {
  const parts: string[] = [];
  for (const rendered of mediaMap.values()) {
    parts.push(chartSearchText(rendered));
    parts.push(chartAxisTitle(rendered, 'x'));
    parts.push(chartAxisTitle(rendered, 'y'));

    const diagram = rendered.spec.diagram;
    if (diagram) {
      parts.push(diagram.nodes.map((node) => node.label).join(' '));
      parts.push(diagram.edges.map((edge) => edge.label || '').join(' '));
    }
  }
  return parts.filter(Boolean).join(' ');
}

function chartTypeMatches(actual: string, expected: ChartRequirement['chartType']) {
  if (!expected) return true;
  if (expected === 'pie') return actual === 'pie' || actual === 'doughnut' || actual === 'polarArea';
  return actual === expected;
}

function renderedDiagramMatchesRequirement(rendered: RenderedChart) {
  const diagram = rendered.spec.diagram;
  return !!rendered.png
    && !!diagram
    && Array.isArray(diagram.nodes)
    && Array.isArray(diagram.edges)
    && diagram.nodes.length >= 2
    && diagram.edges.length >= 1;
}

function renderedChartMatchesRequirement(rendered: RenderedChart, requirement: ChartRequirement) {
  if (requirement.requiresDiagram) {
    return renderedDiagramMatchesRequirement(rendered);
  }

  const chartjs = rendered.spec.chartjs;
  if (!chartjs || !rendered.png) return false;

  const actualType = String(chartjs.type || '').toLowerCase();
  if (!chartTypeMatches(actualType, requirement.chartType)) return false;

  if (requirement.xAxis && !looseLabelMatches(chartAxisTitle(rendered, 'x'), requirement.xAxis)) {
    return false;
  }

  const requiredYAxis = requirement.yAxis;
  if (requiredYAxis) {
    const yAxisTitle = chartAxisTitle(rendered, 'y');
    const datasetLabels = chartDatasetLabels(rendered);
    if (!looseLabelMatches(yAxisTitle, requiredYAxis)
      && !datasetLabels.some((label) => looseLabelMatches(label, requiredYAxis))) {
      return false;
    }
  }

  return true;
}

function hasMismatchedChartRequirement(mediaMap: Map<string, RenderedChart>, requirement: ChartRequirement | undefined) {
  if (!requirement) return false;
  const renderedCharts = Array.from(mediaMap.values()).filter((rendered) => rendered.png);
  if (renderedCharts.length === 0) return false;
  if (requirement.requiresDiagram
    && !renderedCharts.some((rendered) => renderedChartMatchesRequirement(rendered, { requiresDiagram: true }))) {
    return true;
  }

  const requiredTypes = requirement.chartTypes?.length
    ? requirement.chartTypes
    : requirement.chartType
      ? [requirement.chartType]
      : [];
  if (requiredTypes.length > 0) {
    return requiredTypes.some((chartType) => !renderedCharts.some((rendered) => renderedChartMatchesRequirement(rendered, {
      chartType,
      xAxis: requirement.xAxis,
      yAxis: requirement.yAxis,
    })));
  }

  if (requirement.xAxis || requirement.yAxis) {
    return !renderedCharts.some((rendered) => renderedChartMatchesRequirement(rendered, requirement));
  }

  return false;
}

function structuredDataLabelMatchesChart(text: string, dataAnalysis: Extract<StructuredDataAnalysisResult, { status: 'completed' }>) {
  const labels = [
    ...dataAnalysis.columns,
    ...Object.keys(dataAnalysis.numericColumns),
    ...Object.values(dataAnalysis.groupedNumericColumns || {}).flatMap((summary) => [
      summary.groupColumn,
      summary.valueColumn,
      ...Object.keys(summary.groups),
    ]),
    ...Object.keys(dataAnalysis.dateColumns || {}),
    ...Object.keys(dataAnalysis.missingValues || {}),
    ...(dataAnalysis.weightedAverages || []).flatMap((summary) => [summary.valueColumn, summary.weightColumn]),
    ...(dataAnalysis.ratioMetrics || []).flatMap((summary) => [summary.numeratorColumn, summary.denominatorColumn]),
  ];

  return uniqueScopeNames(labels.flatMap(scopeLabelVariants)).some((label) => looseLabelMatches(text, label));
}

function hasChartDataContextMissing(mediaMap: Map<string, RenderedChart>, dataAnalysis: StructuredDataAnalysisResult) {
  if (dataAnalysis.status !== 'completed') return false;
  return Array.from(mediaMap.values()).some((rendered) => {
    if (!rendered.png || chartNumbers(rendered).length === 0) return false;
    const text = `${chartSearchText(rendered)} ${chartAxisTitle(rendered, 'x')} ${chartAxisTitle(rendered, 'y')} ${chartDatasetLabels(rendered).join(' ')}`;
    return !structuredDataLabelMatchesChart(text, dataAnalysis);
  });
}

function matchingNumericSummariesForChart(rendered: RenderedChart, dataAnalysis: Extract<StructuredDataAnalysisResult, { status: 'completed' }>) {
  const text = `${chartSearchText(rendered)} ${chartAxisTitle(rendered, 'x')} ${chartAxisTitle(rendered, 'y')} ${chartDatasetLabels(rendered).join(' ')}`;
  const entries = Object.entries(dataAnalysis.numericColumns);
  const matching = entries.filter(([column]) => scopeLabelVariants(column).some((label) => looseLabelMatches(text, label)));
  if (matching.length > 0) return matching.map(([, summary]) => summary);
  return entries.length === 1 ? [entries[0]![1]] : [];
}

function hasChartValueOutsideStructuredRange(mediaMap: Map<string, RenderedChart>, dataAnalysis: StructuredDataAnalysisResult) {
  if (dataAnalysis.status !== 'completed') return false;

  for (const rendered of mediaMap.values()) {
    if (!rendered.png) continue;
    const values = chartNumbers(rendered);
    if (values.length === 0) continue;
    const text = chartSearchText(rendered);
    const summaries = matchingNumericSummariesForChart(rendered, dataAnalysis);
    if (summaries.length !== 1) continue;
    const summary = summaries[0]!;
    if (/\b(?:sum|total|cumulative)\b|总计|合计|累计|总和/i.test(text)
      && values.some((value) => numberMatchesMetric(text, value, numericSummarySum(summary)))) {
      continue;
    }
    if (/\b(?:count|number of|rows?|records?|observations?)\b|数量|总数|行数|记录数/i.test(text)
      && values.some((value) => roughlyEqual(value, summary.count))) {
      continue;
    }
    if (values.some((value) => value < summary.min - 0.01 || value > summary.max + 0.01)) {
      return true;
    }
  }

  return false;
}

function hasRequiredDataOperationEvidence(
  dataAnalysis: StructuredDataAnalysisResult,
  operations: string[],
) {
  if (operations.length === 0) return true;
  if (dataAnalysis.status !== 'completed') return false;
  const performed = new Set<string>();
  try {
    const parsed = JSON.parse(dataAnalysis.resultJson || '{}');
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (/^(?:operation|operations|performedOperations|dataOperations)$/i.test(key)) {
          if (Array.isArray(child)) child.forEach((item) => performed.add(String(item).toLowerCase()));
          else if (child) performed.add(String(child).toLowerCase());
        } else {
          visit(child);
        }
      }
    };
    visit(parsed);
  } catch {
    return false;
  }

  return operations.every((operation) => performed.has(operation));
}

function requiresNoteCitationStyle(citationStyle: string) {
  return NOTE_CITATION_STYLE_RE.test(citationStyle);
}

function superscriptToPlain(value: string) {
  return Array.from(value)
    .map((char) => SUPERSCRIPT_DIGITS[char] ?? '')
    .join('');
}

function noteMarkersInBody(body: string) {
  const markers = new Set<string>();
  for (const match of body.matchAll(/\^(\d{1,3})/g)) {
    markers.add(match[1]!);
  }
  for (const match of body.matchAll(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g)) {
    const marker = superscriptToPlain(match[0]).replace(/^0+/, '');
    if (marker) markers.add(marker);
  }
  return Array.from(markers);
}

function noteContentLinesBeforeReferences(text: string) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const referenceIndex = lines.findIndex((line) => REFERENCE_HEADING_RE.test(line.trim()));
  const beforeReferences = referenceIndex >= 0 ? lines.slice(0, referenceIndex) : lines;
  const noteHeadingIndex = beforeReferences.findIndex((line) => NOTE_HEADING_RE.test(normalizeHeadingLine(line)));
  if (noteHeadingIndex < 0) return [];
  return beforeReferences.slice(noteHeadingIndex + 1).map((line) => line.trim()).filter(Boolean);
}

function hasMatchingNoteContent(text: string, marker: string) {
  const escapedMarker = escapeRegExp(marker);
  const noteLineRe = new RegExp(`^(?:\\^?${escapedMarker}|${escapeRegExp(marker.split('').map((digit) => Object.entries(SUPERSCRIPT_DIGITS).find(([, plain]) => plain === digit)?.[0] || '').join(''))})[.)]?\\s+\\S.{18,}$`);
  return noteContentLinesBeforeReferences(text).some((line) => noteLineRe.test(line));
}

function lacksRequiredNoteCitations(text: string, citationStyle: string) {
  if (!requiresNoteCitationStyle(citationStyle)) return false;
  const body = extractMainBodyText(text);
  const markers = noteMarkersInBody(body);
  return !NOTE_MARKER_RE.test(body)
    || markers.length === 0
    || AUTHOR_YEAR_CITATION_RE.test(body)
    || !markers.every((marker) => hasMatchingNoteContent(text, marker));
}

function hasDirectQuoteWithoutLocator(text: string) {
  const body = extractMainBodyText(text);
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const noteHeadingIndex = lines.findIndex((line) => NOTE_HEADING_RE.test(normalizeHeadingLine(line)));
  const searchableBody = noteHeadingIndex >= 0 ? lines.slice(0, noteHeadingIndex).join('\n') : body;
  const quoteMatches = [
    ...searchableBody.matchAll(/"([^"]{8,})"/g),
    ...searchableBody.matchAll(/'([^']{8,})'/g),
    ...searchableBody.matchAll(/“([^”]{15,})”/g),
    ...searchableBody.matchAll(/‘([^’]{15,})’/g),
    ...searchableBody.matchAll(/「([^」]{15,})」/g),
    ...searchableBody.matchAll(/『([^』]{15,})』/g),
  ];

  return quoteMatches.some((match) => {
    if (match.index === undefined) return false;
    const nearby = searchableBody.slice(Math.max(0, match.index - 120), Math.min(searchableBody.length, match.index + match[0].length + 160));
    return !SOURCE_LOCATOR_RE.test(nearby);
  });
}

function normalizedScopeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function analysisScopeEntries(dataAnalysis: StructuredDataAnalysisResult) {
  if (dataAnalysis.status !== 'completed') return [];
  const filenames = dataAnalysis.files?.map((file) => file.filename) || [dataAnalysis.filename];
  return filenames
    .flatMap((filename) => String(filename).split(',').map((part) => part.trim()))
    .filter(Boolean);
}

function analysisSheetNames(dataAnalysis: StructuredDataAnalysisResult) {
  return analysisScopeEntries(dataAnalysis)
    .map((entry) => entry.split(':').slice(1).join(':').trim())
    .filter(Boolean);
}

function matchesRequiredScopeName(value: string, required: string) {
  const valueKey = normalizedScopeKey(value);
  const requiredKey = normalizedScopeKey(required);
  return !!valueKey && !!requiredKey && (valueKey === requiredKey || valueKey.includes(requiredKey));
}

function hasRequiredBodyHeadingsInOrder(text: string, requiredHeadings: string[]) {
  if (requiredHeadings.length === 0) return true;

  const headings = extractBodyHeadingLines(text).map(normalizeHeadingLine);
  let searchFrom = 0;

  for (const requiredHeading of requiredHeadings) {
    const foundIndex = headings
      .slice(searchFrom)
      .findIndex((heading) => matchesRequiredScopeName(heading, requiredHeading));
    if (foundIndex < 0) {
      return false;
    }
    searchFrom += foundIndex + 1;
  }

  return true;
}

function hasReferenceYearViolation(text: string, minimumReferenceYear?: number) {
  if (minimumReferenceYear === undefined) return false;
  const summary = summarizeReferenceCompliance(text);
  if (summary.analyses.length === 0) return true;
  return summary.analyses.some((analysis) => (
    typeof analysis.year !== 'number' || analysis.year < minimumReferenceYear
  ));
}

function looksLikePeerReviewedReference(entry: string) {
  const normalized = normalizeText(entry);
  if (!normalized) return false;
  if (WEB_ONLY_REFERENCE_RE.test(normalized) && !/(?:https?:\/\/doi\.org\/|\bdoi:\s*)/i.test(normalized)) {
    return false;
  }

  return /(?:https?:\/\/doi\.org\/|\bdoi:\s*)/i.test(normalized)
    || /\bJournal of\b/i.test(normalized)
    || /\b[A-Z][A-Za-z &-]+\s+(?:Journal|Quarterly)\b/.test(normalized)
    || /\b\d+\(\d+\),\s*\d+/i.test(normalized)
    || /\b(?:volume|vol\.?)\s*\d+[^.]{0,40}\b(?:issue|no\.?)\s*\d+/i.test(normalized);
}

function hasPeerReviewedReferenceViolation(text: string, requiresPeerReviewedReferences: boolean) {
  if (!requiresPeerReviewedReferences) return false;
  const summary = summarizeReferenceCompliance(text);
  if (summary.analyses.length === 0) return true;
  return summary.referenceEntries.some((entry) => !looksLikePeerReviewedReference(entry));
}

function scopeLabelVariants(value: string) {
  const parts = value.split(':').map((part) => part.trim()).filter(Boolean);
  return uniqueScopeNames([value, parts[parts.length - 1] || value]);
}

function hasRequiredDataScopeEvidence(dataAnalysis: StructuredDataAnalysisResult, dataScope: DataScopeRequirement) {
  if (dataAnalysis.status !== 'completed') return false;

  const sheetNames = analysisSheetNames(dataAnalysis);
  if (dataScope.requiredSheetNames.length > 0
    && !dataScope.requiredSheetNames.every((required) => sheetNames.some((sheet) => matchesRequiredScopeName(sheet, required)))) {
    return false;
  }

  const columnNames = dataAnalysis.columns.map((column) => column.split(':').pop() || column);
  if (dataScope.requiredColumnNames.length > 0
    && !dataScope.requiredColumnNames.every((required) => columnNames.some((column) => matchesRequiredScopeName(column, required)))) {
    return false;
  }

  const groupNames = Object.values(dataAnalysis.groupedNumericColumns || {})
    .flatMap((summary) => Object.keys(summary.groups));
  if (dataScope.requiredGroupNames.length > 0
    && !dataScope.requiredGroupNames.every((required) => groupNames.some((group) => matchesRequiredScopeName(group, required)))) {
    return false;
  }

  if (dataScope.dateRange) {
    const dateSummaries = [
      ...Object.values(dataAnalysis.dateColumns || {}),
      ...(dataAnalysis.files || []).flatMap((file) => Object.values(file.dateColumns || {})),
    ];
    if (dateSummaries.length === 0) return false;
    if (dateSummaries.some((summary) => summary.min < dataScope.dateRange!.start || summary.max > dataScope.dateRange!.end)) {
      return false;
    }
  }

  return true;
}

function hasDisallowedDataScopeClaim(text: string, dataAnalysis: StructuredDataAnalysisResult, dataScope: DataScopeRequirement) {
  if (dataAnalysis.status !== 'completed') return false;
  const sentences = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean);

  if (dataScope.requiredSheetNames.length > 0) {
    const sheetNames = analysisSheetNames(dataAnalysis);
    const disallowedSheets = sheetNames.filter((sheet) => !dataScope.requiredSheetNames.some((required) => matchesRequiredScopeName(sheet, required)));
    if (disallowedSheets.some((sheet) => looseLabelMatches(text, sheet))) {
      return true;
    }
  }

  if (dataScope.requiredColumnNames.length > 0) {
    const allowedKeys = new Set(dataScope.requiredColumnNames.map(normalizedScopeKey));
    const disallowedColumns = Object.keys(dataAnalysis.numericColumns)
      .map((column) => column.split(':').pop() || column)
      .filter((column) => !allowedKeys.has(normalizedScopeKey(column)));
    if (sentences.some((sentence) => /mean|average|min|minimum|max|maximum|median|standard deviation|std\.?\s*dev\.?|sd|平均|均值|最大|最小|中位数|标准差/i.test(sentence)
      && disallowedColumns.some((column) => looseLabelMatches(sentence, column)))) {
      return true;
    }
  }

  if (dataScope.requiredGroupNames.length > 0) {
    const requiredGroupNames = dataScope.requiredGroupNames;
    const allGroupNames = Object.values(dataAnalysis.groupedNumericColumns || {})
      .flatMap((summary) => Object.keys(summary.groups));
    const disallowedGroups = allGroupNames.filter((group) => !requiredGroupNames.some((required) => matchesRequiredScopeName(group, required)));
    if (disallowedGroups.some((group) => looseLabelMatches(text, group))) {
      return true;
    }

    const groupedMetricSentences = sentences.filter((sentence) => Object.values(dataAnalysis.groupedNumericColumns || {}).some((summary) => (
      scopeLabelVariants(summary.valueColumn).some((valueColumn) => looseLabelMatches(sentence, valueColumn))
      && /mean|average|min|minimum|max|maximum|median|standard deviation|std\.?\s*dev\.?|sd|平均|均值|最大|最小|中位数|标准差/i.test(sentence)
    )));
    if (groupedMetricSentences.some((sentence) => !requiredGroupNames.some((group) => looseLabelMatches(sentence, group)))) {
      return true;
    }
  }

  if (dataScope.dateRange) {
    const dates = Array.from(text.matchAll(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)).map((match) => match[0]!.replace(/\//g, '-'));
    if (dates.length >= 2 && (!dates.includes(dataScope.dateRange.start) || !dates.includes(dataScope.dateRange.end))) {
      return true;
    }
    const body = extractMainBodyText(text);
    const mentionsDateScope = body.includes(dataScope.dateRange.start)
      || body.includes(dataScope.dateRange.end)
      || looseLabelMatches(body, dataScope.dateRange.label);
    if (!mentionsDateScope) {
      return true;
    }
  }

  return false;
}

function hasUncitedPreciseProfessionalParameter(text: string) {
  const match = text.match(PRECISE_PARAMETER_RE);
  if (!match || match.index === undefined) return false;
  const nearby = text.slice(Math.max(0, match.index - 120), Math.min(text.length, match.index + match[0].length + 120));
  return !CITATION_NEARBY_RE.test(nearby);
}

function hasActionableHighRiskDetail(text: string) {
  return ACTIONABLE_HIGH_RISK_DETAIL_RE.test(text)
    || ACTIONABLE_HIGH_RISK_REVERSE_PARAMETER_RE.test(text)
    || ACTIONABLE_HIGH_RISK_ALIAS_DETAIL_RE.test(text)
    || ACTIONABLE_HIGH_RISK_LOCAL_DETAIL_RE.test(text)
    || ACTIONABLE_HIGH_RISK_EDGE_DETAIL_RE.test(text)
    || ACTIONABLE_HIGH_RISK_SECOND_WAVE_DETAIL_RE.test(text)
    || ACTIONABLE_HIGH_RISK_THIRD_WAVE_DETAIL_RE.test(text)
    || ACTIONABLE_HIGH_RISK_FIFTH_WAVE_DETAIL_RE.test(text)
    || PRECISE_PARAMETER_RE.test(text);
}

function hasActionableLegalFinancialAdvice(text: string) {
  return extractMainBodyText(text)
    .split(/(?<=[.!?。！？])\s+/)
    .filter(Boolean)
    .some((sentence) => ACTIONABLE_LEGAL_FINANCIAL_FINAL_RE.test(sentence)
      && !/\b(?:do\s+not|does\s+not|did\s+not|not|no|without|avoid|exclude|cannot|can't|must\s+not|should\s+not|prohibit(?:s|ed)?)\b|不(?:应|能|会|得)|不得|避免|禁止/.test(sentence));
}

function hasActionableHighRiskChartParameter(mediaMap: Map<string, RenderedChart>) {
  for (const rendered of mediaMap.values()) {
    if (!rendered.png) continue;
    const values = chartNumbers(rendered);
    if (values.length === 0) continue;
    const labelsAndAxes = [
      chartSearchText(rendered),
      chartAxisTitle(rendered, 'x'),
      chartAxisTitle(rendered, 'y'),
      chartDatasetLabels(rendered).join(' '),
    ].join(' ');
    if (ACTIONABLE_HIGH_RISK_CHART_LABEL_RE.test(labelsAndAxes)
      && (ACTIONABLE_HIGH_RISK_CHART_UNIT_RE.test(labelsAndAxes) || values.some((value) => Math.abs(value) >= 1))) {
      return true;
    }
  }

  return false;
}

function hasPrivateIdentifierLeak(text: string) {
  if (PRIVATE_IDENTIFIER_TEXT_RE.test(text)) return true;
  return Array.from(text.matchAll(/(?:\+\d[\d\s().-]{7,}\d|(?:phone|tel|mobile|contact|电话|手机|联系方式)\s*[:：]?\s*\+?\d[\d\s().-]{7,}\d)/gi)).some((match) => (
    match[0].replace(/\D/g, '').length >= 8
  ));
}

function collectChartRenderFailures(chartText: string, mediaMap: Map<string, RenderedChart>) {
  const failures: string[] = [];
  const placeholders = chartPlaceholders(chartText);

  for (const placeholder of placeholders) {
    const rendered = mediaMap.get(placeholder);
    if (!rendered?.png || rendered.png.length === 0) {
      failures.push(placeholder);
    }
  }

  for (const [placeholder, rendered] of mediaMap.entries()) {
    if (!rendered?.png || rendered.png.length === 0) {
      failures.push(placeholder);
    }
  }

  return Array.from(new Set(failures));
}

function hasVisualAfterReferences(chartText: string) {
  const lines = String(chartText || '').replace(/\r\n/g, '\n').split('\n');
  const referenceHeadingIndex = lines.findIndex((line) => /^(references|reference list|bibliography|works cited|参考文献|引用文献)\s*$/i.test(line.trim()));
  if (referenceHeadingIndex < 0) return false;
  const afterReferences = lines.slice(referenceHeadingIndex + 1).join('\n');
  return chartPlaceholders(afterReferences).length > 0;
}

export function assertFinalAcademicDelivery(input: FinalAcademicDeliveryInput) {
  const failureCodes: string[] = [];
  const safetyText = normalizeSafetyDetectionText(input.finalText);
  const deliveredVisuals = countSuccessfulVisuals(input.chartText, input.mediaMap);
  const assessment = assessGeneratedPaper(input.finalText, {
    requiredReferenceCount: input.requiredReferenceCount,
    citationStyle: input.citationStyle,
  });

  if (!assessment.valid) {
    failureCodes.push('paper_quality_failed');
  }

  if (RAW_ARTIFACT_RE.test(input.finalText)) {
    failureCodes.push('format_artifact_leftover');
  }

  if (SENSITIVE_INTERNAL_ARTIFACT_RE.test(safetyText)) {
    failureCodes.push('sensitive_internal_artifact');
  }

  if (PROMPT_INJECTION_ARTIFACT_RE.test(safetyText)) {
    failureCodes.push('prompt_injection_artifact');
  }

  if (hasPrivateIdentifierLeak(safetyText)) {
    failureCodes.push('private_identifier_leak');
  }

  if (!isWordCountWithinRange(input.finalText, input.targetWords)) {
    failureCodes.push('word_count_out_of_range');
  }

  if (!hasEnoughBodySections(input.finalText, input.requiredSectionCount)) {
    failureCodes.push('section_count_too_low');
  }

  if (!hasAllRequiredDocumentElements(input.finalText, input.profile.requiredDocumentElements)) {
    failureCodes.push('required_document_element_missing');
  }

  if (!hasRequiredDocumentElementsInOrder(input.finalText, input.profile.requiredDocumentElements)) {
    failureCodes.push('required_document_element_order_mismatch');
  }

  if (!hasPopulatedTableOfContents(input.finalText, input.profile.requiredDocumentElements)) {
    failureCodes.push('table_of_contents_empty');
  }

  if (requiredDocumentElementsWithEmptyContent(input.finalText, input.profile.requiredDocumentElements).length > 0) {
    failureCodes.push('required_document_element_empty');
  }

  if (requiredDocumentElementsWithPlaceholderContent(input.finalText, input.profile.requiredDocumentElements)) {
    failureCodes.push('required_document_element_placeholder');
  }

  if (!hasRequiredBodyHeadingsInOrder(input.finalText, input.profile.requiredBodyHeadings)) {
    failureCodes.push('required_heading_order_mismatch');
  }

  if (requiredBodyHeadingsWithEmptyContent(input.finalText, input.profile.requiredBodyHeadings).length > 0) {
    failureCodes.push('required_heading_empty');
  }

  if (hasReferenceYearViolation(input.finalText, input.profile.minimumReferenceYear)) {
    failureCodes.push('reference_year_too_old');
  }

  if (hasPeerReviewedReferenceViolation(input.finalText, input.profile.requiresPeerReviewedReferences)) {
    failureCodes.push('peer_reviewed_reference_required');
  }

  if (hasExternalSourceViolation(input.finalText, input.profile.externalSourcesAllowed)) {
    failureCodes.push('external_source_violation');
  }

  if (input.profile.requiresTable && !hasMarkdownTable(input.finalText)) {
    failureCodes.push('table_required');
  }

  if (input.profile.prohibitsBulletLists && hasBulletOrNumberedList(input.finalText)) {
    failureCodes.push('bullet_list_prohibited');
  }

  if (input.profile.prohibitsFirstPerson && hasFirstPersonUsage(input.finalText)) {
    failureCodes.push('first_person_prohibited');
  }

  const chartFailures = collectChartRenderFailures(input.chartText, input.mediaMap);
  if (chartFailures.length > 0) {
    failureCodes.push('chart_render_failed');
  }

  if (input.profile.requiresVisual && deliveredVisuals === 0) {
    failureCodes.push('visual_required');
  }

  if (input.profile.requiresVisual && !hasRequiredChartCaptionAndBodyReference(input.chartText, input.mediaMap)) {
    failureCodes.push('chart_caption_or_reference_missing');
  }

  if (input.profile.requiredVisualCount > 0 && deliveredVisuals < input.profile.requiredVisualCount) {
    failureCodes.push('visual_count_too_low');
  }

  if (input.profile.maximumVisualCount !== undefined && deliveredVisuals > input.profile.maximumVisualCount) {
    failureCodes.push('visual_count_too_high');
  }

  if (input.profile.prohibitsVisuals && deliveredVisuals > 0) {
    failureCodes.push('visual_prohibited');
  }

  if (input.profile.requiresVisual && hasVisualAfterReferences(input.chartText)) {
    failureCodes.push('visual_after_references');
  }

  if (input.profile.requiresDataAnalysis && input.dataAnalysis.status !== 'completed') {
    failureCodes.push('data_analysis_missing');
  }

  if (input.profile.requiresDataAnalysis && hasUnsupportedDataClaim(input.finalText, input.dataAnalysis)) {
    failureCodes.push('unsupported_data_analysis_claim');
  }

  if (input.profile.requiresDataAnalysis && hasMismatchedDataMetricClaim(input.finalText, input.dataAnalysis)) {
    failureCodes.push('data_metric_mismatch');
  }

  if (input.profile.requiresDataAnalysis && hasMismatchedChartMetric(input.mediaMap, input.dataAnalysis)) {
    failureCodes.push('chart_data_metric_mismatch');
  }

  if (input.profile.requiresDataAnalysis && hasChartDataContextMissing(input.mediaMap, input.dataAnalysis)) {
    failureCodes.push('chart_data_context_missing');
  }

  if (input.profile.requiresDataAnalysis && hasChartValueOutsideStructuredRange(input.mediaMap, input.dataAnalysis)) {
    failureCodes.push('chart_data_metric_mismatch');
  }

  if (input.profile.requiresDataAnalysis
    && !hasRequiredDataOperationEvidence(input.dataAnalysis, input.profile.unsupportedDataOperations)) {
    failureCodes.push('unsupported_data_operation');
  }

  if (hasMismatchedChartRequirement(input.mediaMap, input.profile.chartRequirement)) {
    failureCodes.push('chart_spec_mismatch');
  }

  if (input.profile.requiresDataAnalysis && input.profile.dataScope) {
    if (!hasRequiredDataScopeEvidence(input.dataAnalysis, input.profile.dataScope)) {
      failureCodes.push('data_scope_missing');
    } else if (hasDisallowedDataScopeClaim(input.finalText, input.dataAnalysis, input.profile.dataScope)) {
      failureCodes.push('data_scope_mismatch');
    }
  }

  if (lacksRequiredNoteCitations(input.finalText, input.citationStyle)) {
    failureCodes.push('note_citation_required');
  }

  if (hasDirectQuoteWithoutLocator(input.finalText)) {
    failureCodes.push('direct_quote_missing_locator');
  }

  if (hasActionableLegalFinancialAdvice(input.finalText)) {
    failureCodes.push('actionable_legal_financial_advice');
  }

  if (
    input.profile.requiresProfessionalParameters
    && input.profile.parameterHandling.action === 'high_level_schematic'
    && !HIGH_LEVEL_SCHEMATIC_RE.test(input.finalText)
  ) {
    failureCodes.push('professional_schematic_not_explicit');
  }

  if (
    input.profile.requiresProfessionalParameters
    && input.profile.parameterHandling.action === 'high_level_schematic'
    && (hasActionableHighRiskDetail(`${input.finalText}\n${input.chartText}\n${renderedVisualSafetyText(input.mediaMap)}`)
      || hasActionableHighRiskChartParameter(input.mediaMap))
  ) {
    failureCodes.push('professional_actionable_detail');
  }

  if (
    input.profile.requiresProfessionalParameters
    && input.profile.parameterHandling.action === 'web_lookup_first'
    && hasUncitedPreciseProfessionalParameter(input.finalText)
  ) {
    failureCodes.push('uncited_professional_parameter');
  }

  if (failureCodes.length > 0) {
    throw new Error(`quality_gate_failed:${failureCodes.join(',')}`);
  }
}

export function buildQualityContextForPrompt(
  profile: WritingQualityRequirementProfile,
  dataAnalysis: StructuredDataAnalysisResult,
) {
  const lines: string[] = [];

  lines.push('QUALITY GATE CONTEXT: Follow these delivery rules exactly.');

  if (!profile.externalSourcesAllowed) {
    lines.push('- External source restriction detected. Use only the uploaded materials; do not use web search, browsing, or newly found external references. If the uploaded materials are insufficient, do not invent missing sources or parameters.');
  }

  if (profile.requiresVisual) {
    lines.push(`- Visual requirement detected. If a chart, figure, or diagram is required, produce a renderable chart/table specification instead of prose-only discussion.`);
    lines.push('- Every rendered chart or diagram must have a numbered caption/title and a nearby body sentence that explicitly refers to it (for example, "Figure 1 shows...").');
    if (profile.chartRequirement?.requiresDiagram) {
      lines.push('- Flowchart/diagram requirement detected. Deliver a real diagram specification with at least two labelled nodes and at least one arrow/edge; do not substitute a table, bar chart, or prose-only list.');
    }
    if (profile.chartRequirement?.chartTypes && profile.chartRequirement.chartTypes.length > 1) {
      lines.push(`- Multiple chart types required. Deliver each requested chart type separately: ${profile.chartRequirement.chartTypes.join(', ')}.`);
    }
    if (profile.maximumVisualCount !== undefined) {
      lines.push(`- Visual count limit detected. Do not deliver more than ${profile.maximumVisualCount} visual(s).`);
    }
  }

  if (profile.prohibitsVisuals) {
    lines.push('- Visual prohibition detected. Do not add charts, figures, diagrams, flowcharts, or image placeholders.');
  }

  if (profile.requiresTable) {
    lines.push('- Table requirement detected. Include a real markdown table with a header row, separator row, and data rows in the paper body.');
  }

  if (profile.prohibitsBulletLists) {
    lines.push('- Bullet/list prohibition detected. Write the main body in full academic paragraphs, not bullet points or numbered lists.');
  }

  if (profile.prohibitsFirstPerson) {
    lines.push('- First-person prohibition detected. Write in third person and do not use first-person pronouns such as I, we, my, our, 我, or 我们 in the paper body.');
  }

  if (profile.requiredDocumentElements.length > 0) {
    const labels: Record<RequiredDocumentElement, string> = {
      introduction: 'Introduction',
      abstract: 'Abstract',
      table_of_contents: 'Table of Contents',
      appendix: 'Appendix',
      executive_summary: 'Executive Summary',
      policy_options: 'Policy Options',
      recommendation: 'Recommendation',
      literature_review: 'Literature Review',
      methodology: 'Methodology',
      results: 'Results',
      discussion: 'Discussion',
      conclusion: 'Conclusion',
    };
    lines.push(`- Required document sections detected. Include clear heading lines for: ${profile.requiredDocumentElements.map((element) => labels[element]).join(', ')}. Required sections must contain real content; do not leave placeholder or heading-only Abstract, Appendix, Executive Summary, Policy Options, Recommendation, Methodology, Results, Discussion, or Conclusion sections.`);
  }

  if (profile.requiredBodyHeadings.length > 0) {
    lines.push(`- Exact outline heading order detected. Use these body headings in this order and do not swap or omit them: ${profile.requiredBodyHeadings.join(' -> ')}.`);
  }

  if (profile.minimumReferenceYear !== undefined) {
    lines.push(`- Recent-source requirement detected. Every reference must be from ${profile.minimumReferenceYear} or later; do not include older sources unless the user explicitly allows historical background sources.`);
  }

  if (profile.requiresPeerReviewedReferences) {
    lines.push('- Peer-reviewed source requirement detected. References must be journal-style scholarly sources with clear journal/volume/issue or DOI evidence; do not use blogs, course guides, news pages, or generic websites as replacements.');
  }

  if (profile.requiresDataAnalysis) {
    if (dataAnalysis.status === 'completed') {
      lines.push(`- Data analysis evidence is available. Use only these structured results when making numeric claims: ${dataAnalysis.resultJson}`);
      lines.push('- Data-backed charts must use labels, axes, and numbers that clearly match the structured data evidence; do not use generic labels such as "value" when the dataset has specific field names.');
      if (profile.dataScope) {
        const scopeParts = [
          profile.dataScope.requiredSheetNames.length > 0 ? `sheet(s): ${profile.dataScope.requiredSheetNames.join(', ')}` : '',
          profile.dataScope.requiredColumnNames.length > 0 ? `column(s): ${profile.dataScope.requiredColumnNames.join(', ')}` : '',
          profile.dataScope.requiredGroupNames.length > 0 ? `group(s): ${profile.dataScope.requiredGroupNames.join(', ')}` : '',
          profile.dataScope.dateRange ? `date range: ${profile.dataScope.dateRange.start} to ${profile.dataScope.dateRange.end}` : '',
        ].filter(Boolean);
        lines.push(`- Data scope requirement detected. Only use and explicitly state the requested scope (${scopeParts.join('; ')}). Do not mix in other worksheets, columns, groups, or date ranges.`);
      }
      if (profile.unsupportedDataOperations.length > 0) {
        lines.push(`- Advanced data operation requested (${profile.unsupportedDataOperations.join(', ')}). Only claim this result if the structured data evidence explicitly records that operation; otherwise say the uploaded data cannot be analyzed to that level reliably.`);
      }
    } else {
      lines.push(`- Data analysis was requested, but no completed structured result is available. Do not invent numeric findings.`);
    }
  }

  if (profile.requiresProfessionalParameters) {
    if (profile.parameterHandling.action === 'web_lookup_first') {
      lines.push('- Professional medical/engineering figure rule: web lookup first. If precise parameters are missing and external sources are allowed, verify suitable public data through web search and include the source in References. If no suitable public source can verify the parameters, downgrade to a verifiable high-level schematic.');
    } else if (profile.parameterHandling.action === 'high_level_schematic') {
      lines.push('- Professional medical/engineering figure rule: external lookup is blocked or inappropriate. Use a verifiable high-level schematic only; do not invent exact parameters.');
    }
  }

  if (profile.requiresRubricReview) {
    lines.push('- Rubric or marking criteria detected. The final paper must satisfy the uploaded assignment/rubric requirements, not just general academic quality.');
  }

  return lines.join('\n');
}
