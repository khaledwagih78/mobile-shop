import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Bot,
  Send,
  ShieldCheck,
  Lock,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Boxes,
  Coins,
  MessageSquare,
  HelpCircle,
  CheckCircle2,
  Trash2,
  Zap,
} from 'lucide-react';
import { db, getSetting, dayOf, totalStock } from '../db';
import { money, fmt } from '../utils';
import { isAiAllowed } from '../plans';
import { analyzeStoreData, chatWithStoreAdvisor, isGeminiConfigured } from '../services/gemini';
import MarkdownView from '../components/MarkdownView';

const daysAgo = (n) => dayOf(new Date(Date.now() - n * 86400000).toISOString());

const QUICK_QUESTIONS = [
  'ما هو تقييمك الشامل لأداء ونمو المتجر؟',
  'ما هي الأصناف الأكثر ربحية التي ينبغي التركيز عليها؟',
  'كيف أتعامل مع البضاعة الراكدة لتحرير السيولة؟',
  'من هم أكبر العملاء المدينين وما التوصية لتحصيل الديون؟',
  'كيف يمكنني خفض التكاليف ورفع هامش الربح الإجمالي؟',
];

export default function Insights() {
  const navigate = useNavigate();
  const invoices = useLiveQuery(() => db.invoices.toArray(), [], []);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], []);
  const plan = useLiveQuery(() => getSetting('plan', 'pro'), [], 'pro');

  const hasAiAccess = isAiAllowed(plan);

  // AI Analysis state
  const [analysis, setAnalysis] = useState({ status: 'idle', text: '', model: '' });

  // Chatbot state
  const [chatHistory, setChatHistory] = useState([
    {
      role: 'assistant',
      text: 'مرحباً بك! أنا مستشارك الذكي المالي والتجاري. يمكنني تحليل كل ما حدث في متجرك من مبيعات ومخزون وديون وربحية، والإجابة عن أي استفسار لمساعدتك في اتخاذ أفضل القرارات (للقراءة والتحليل فقط). كيف يمكنني مساعدتك اليوم؟',
    },
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('analysis'); // 'analysis' | 'chat'

  // Comprehensive business calculation
  const A = useMemo(() => analyze(invoices, items, customers, expenses), [invoices, items, customers, expenses]);

  // Prepared store summary for AI
  const storeSummary = useMemo(() => {
    return {
      'مبيعات آخر 7 أيام': `${money(A.sales7)} (${A.count7} فاتورة)`,
      'مبيعات الـ7 أيام السابقة': money(A.salesPrev7),
      'اتجاه المبيعات': `${A.trend >= 0 ? '+' : ''}${A.trend}%`,
      'مبيعات آخر 30 يوم': money(A.sales30),
      'إجمالي الأرباح التقديرية (30 يوم)': money(A.profit30),
      'إجمالي المصروفات (30 يوم)': money(A.expenses30),
      'صافي الربح بعد المصروفات (30 يوم)': money(A.netProfit30),
      'نسبة هامش الربح %': `${A.marginPct}%`,
      'أصناف تتطلب إعادة طلب عاجلة': A.restock.slice(0, 10).map((r) => `${r.name} (رصيد ${r.stock} — يكفي ${r.cover} يوم)`),
      'أصناف راكدة بدون حركة': A.dead.slice(0, 10).map((d) => `${d.name} (رصيد ${d.stock} — قيمة محبوسة ${money(d.stock * d.costPrice)})`),
      'رأس المال المحبوس في الرواكد': money(A.deadValue),
      'أعلى 5 أصناف تحقيقاً للربح': A.topProfit.slice(0, 5).map((t) => `${t.name}: ربح ${Math.round(t.profit)} ج.م (هامش ${t.margin}%)`),
      'أكبر 5 مديونيات على العملاء': A.topDebts.slice(0, 5).map((c) => `${c.name}: ${Math.round(c.balance)} ج.م`),
      'أصناف بهامش ربح ضعيف (<15%)': A.lowMargin.slice(0, 8).map((l) => `${l.name}: هامش ${l.margin}%`),
    };
  }, [A]);

  const runAnalysis = async () => {
    if (!hasAiAccess) return;
    setAnalysis({ status: 'loading', text: '', model: '' });
    try {
      const res = await analyzeStoreData(storeSummary);
      setAnalysis({ status: 'done', text: res.text, model: res.modelUsed });
    } catch (e) {
      setAnalysis({ status: 'error', text: e.message || 'تعذر تشغيل التحليل بالذكاء الاصطناعي' });
    }
  };

  const handleSendChat = async (userText) => {
    const textToSend = (userText || inputMsg).trim();
    if (!textToSend || chatLoading || !hasAiAccess) return;

    const newHistory = [...chatHistory, { role: 'user', text: textToSend }];
    setChatHistory(newHistory);
    setInputMsg('');
    setChatLoading(true);

    try {
      const res = await chatWithStoreAdvisor({
        message: textToSend,
        history: newHistory.slice(0, -1),
        storeSummary,
      });

      setChatHistory([
        ...newHistory,
        { role: 'assistant', text: res.text, model: res.modelUsed },
      ]);
    } catch (err) {
      setChatHistory([
        ...newHistory,
        {
          role: 'assistant',
          text: `عذراً، حدث خطأ أثناء معالجة الطلب: ${err.message || 'يرجى المحاولة مجدداً.'}`,
          isError: true,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            المساعد والتحليلات الذكية
          </h1>
          <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 13 }}>
            تحليل شامل لأداء المنشأة والمبيعات والمخزون والسيولة النقدية مدعوم بنموذج Google Gemini 3.5 Flash-Lite
          </p>
        </div>

        {/* Strict Analyze-Only Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(15, 76, 92, 0.08)',
            color: 'var(--primary)',
            padding: '6px 12px',
            borderRadius: 10,
            fontSize: 12.5,
            fontWeight: 600,
            border: '1px solid rgba(15, 76, 92, 0.2)',
          }}
        >
          <ShieldCheck size={16} />
          <span>وضع التحليل فقط (Analyze-Only) — الذكاء الاصطناعي للقراءة والتشخيص فقط دون تعديل أو حذف البيانات</span>
        </div>
      </div>

      {/* Top High-Contrast KPIs */}
      <div className="kpis">
        <div className={`kpi ${A.trend >= 0 ? 'tone-green' : 'tone-red'}`}>
          <div className="label">اتجاه المبيعات (آخر 7 أيام)</div>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {A.trend >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {A.trend >= 0 ? '+' : ''}{A.trend}%
            </span>
          </div>
          <div className="sub">{money(A.sales7)} مقابل {money(A.salesPrev7)} سابقاً</div>
        </div>

        <div className="kpi tone-green">
          <div className="label">هامش الربح الإجمالي (30 يوم)</div>
          <div className="value" style={{ fontVariantNumeric: 'tabular-nums' }}>{A.marginPct}%</div>
          <div className="sub">إجمالي أرباح {money(A.profit30)}</div>
        </div>

        <div className="kpi tone-accent">
          <div className="label">أصناف تحتاج إعادة طلب فورية</div>
          <div className="value" style={{ fontVariantNumeric: 'tabular-nums' }}>{A.restock.length}</div>
          <div className="sub">أوشكت على النفاد أو قاربت الصفر</div>
        </div>

        <div className="kpi tone-red">
          <div className="label">أصناف راكدة (بدون حركة 30+ يوم)</div>
          <div className="value" style={{ fontVariantNumeric: 'tabular-nums' }}>{A.dead.length}</div>
          <div className="sub">رأس مال محبوس {money(A.deadValue)}</div>
        </div>
      </div>

      {/* Subscription Tier Check: If Free Plan, Display Pro Upgrade Banner */}
      {!hasAiAccess ? (
        <div
          className="card"
          style={{
            marginBottom: 20,
            border: '2px solid rgba(15, 76, 92, 0.3)',
            borderRadius: 10,
            background: '#ffffff',
            padding: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: 'rgba(15, 76, 92, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                flexShrink: 0,
              }}
            >
              <Lock size={26} />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>
                  التحليلات الذكية بالذكاء الاصطناعي متاحة في باقة Pro
                </h3>
                <span className="badge amber" style={{ fontSize: 12 }}>الخطة الحالية: مجانية (Free)</span>
              </div>
              <p style={{ margin: '8px 0 14px 0', fontSize: 14, color: '#334155', lineHeight: 1.7 }}>
                أنت حالياً على الباقة المجانية. للوصول إلى تحليلات نموذج Google Gemini 3.5 Flash-Lite التلقائية، ودردشة المستشار المالي الذكي، وتشخيص الرواكد والسيولة، يرجى ترقية باقتك إلى <b>الخطة الاحترافية (Pro)</b>.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  onClick={() => navigate('/settings')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Zap size={16} />
                  <span>ترقية الاشتراك إلى باقة Pro</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Pro Plan AI Suite */
        <div className="card" style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--line)' }}>
          {/* Tabs: Comprehensive Analysis vs Interactive Chatbot */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--line)',
              paddingBottom: 12,
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`btn ${activeTab === 'analysis' ? '' : 'ghost'}`}
                onClick={() => setActiveTab('analysis')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Sparkles size={16} />
                <span>التقرير التحليلي الشامل</span>
              </button>

              <button
                className={`btn ${activeTab === 'chat' ? '' : 'ghost'}`}
                onClick={() => setActiveTab('chat')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <MessageSquare size={16} />
                <span>المستشار الذكي (دردشة)</span>
              </button>
            </div>

            <span className="badge green" style={{ fontSize: 12 }}>
              باقة Pro — Google Gemini 3.5 Flash-Lite مفعّل
            </span>
          </div>

          {/* TAB 1: COMPREHENSIVE ANALYSIS */}
          {activeTab === 'analysis' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <b style={{ fontSize: 16 }}>تشخيص أداء المنشأة والمبيعات والربحية</b>
                  <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 13 }}>
                    يقوم النموذج بفحص كامل المبيعات، الرواكد، الديون، وهوامش الربح لتوليد تشخيص تنفيذي شامل.
                  </p>
                </div>

                <button
                  className="btn"
                  onClick={runAnalysis}
                  disabled={analysis.status === 'loading'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <RefreshCw size={15} className={analysis.status === 'loading' ? 'animate-spin' : ''} />
                  <span>{analysis.status === 'loading' ? 'جاري التحليل المعمق...' : 'ابدأ التحليل الشامل الآن'}</span>
                </button>
              </div>

              {analysis.status === 'idle' && (
                <div style={{ marginTop: 20, padding: 24, textAlign: 'center', background: '#f8fafc', borderRadius: 10, border: '1px dashed var(--line)' }}>
                  <Bot size={36} style={{ color: 'var(--primary)', opacity: 0.8, marginBottom: 8 }} />
                  <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>
                    جاهز لتحليل بيانات المتجر الشاملة
                  </p>
                  <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 13 }}>
                    اضغط على "ابدأ التحليل الشامل الآن" لتوليد تقرير تشخيصي متكامل للأداء وهوامش الربح والتوصيات.
                  </p>
                </div>
              )}

              {analysis.status === 'loading' && (
                <div style={{ marginTop: 20, padding: 30, textAlign: 'center', background: '#f8fafc', borderRadius: 10 }}>
                  <RefreshCw size={30} className="animate-spin" style={{ color: 'var(--primary)', marginBottom: 10 }} />
                  <p style={{ margin: 0, fontWeight: 600 }}>جاري فحص مؤشرات الأداء، الرواكد، وهوامش الربح...</p>
                  <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 13 }}>قد يستغرق التحليل بضع ثوانٍ عبر Google Gemini 3.5 Flash-Lite</p>
                </div>
              )}

              {analysis.status === 'error' && (
                <div style={{ marginTop: 16, padding: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: 'var(--red)', fontSize: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
                    <AlertTriangle size={16} />
                    <span>حدث خطأ أثناء إجراء التحليل:</span>
                  </div>
                  <div>{analysis.text}</div>
                </div>
              )}

              {analysis.status === 'done' && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="badge green" style={{ fontSize: 12 }}>
                      تم التحليل بنجاح بواسطة {analysis.model || 'Gemini 3.5 Flash-Lite'}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      تحليل فقط — لا يتم تعديل أي سجل في قاعدة البيانات
                    </span>
                  </div>

                  <div
                    style={{
                      background: 'rgba(15, 76, 92, 0.04)',
                      borderRadius: 10,
                      padding: 20,
                      border: '1px solid rgba(15, 76, 92, 0.15)',
                    }}
                  >
                    <MarkdownView content={analysis.text} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: INTERACTIVE AI CHATBOT */}
          {activeTab === 'chat' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b style={{ fontSize: 16 }}>دردشة المستشار الذكي للأعمال</b>
                  <p className="muted" style={{ margin: '2px 0 0 0', fontSize: 12.5 }}>
                    اسأل عن أي شيء حدث في متجرك وسيقوم المستشار بالرد والتحليل بالاعتماد على بياناتك الفعلية (للقراءة فقط).
                  </p>
                </div>

                <button
                  className="btn ghost"
                  onClick={() =>
                    setChatHistory([
                      {
                        role: 'assistant',
                        text: 'تم بدء محادثة جديدة. يمكنك سؤالي عن مبيعاتك، مخزونك، أصنافك الأكثر ربحاً، أو ديون العملاء.',
                      },
                    ])
                  }
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                >
                  <Trash2 size={14} />
                  <span>مسح المحادثة</span>
                </button>
              </div>

              {/* Quick Questions Chips */}
              <div style={{ marginBottom: 14 }}>
                <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  أسئلة مقترحة بنقرة واحدة:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {QUICK_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      className="btn ghost"
                      onClick={() => handleSendChat(q)}
                      disabled={chatLoading}
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: '#f1f5f9',
                        borderRadius: 8,
                        border: '1px solid var(--line)',
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat Messages Stream */}
              <div
                style={{
                  maxHeight: 440,
                  minHeight: 280,
                  overflowY: 'auto',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: 16,
                  background: '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                {chatHistory.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: m.role === 'user' ? 'var(--primary)' : '#ffffff',
                        color: m.role === 'user' ? '#ffffff' : '#15252b',
                        border: m.role === 'user' ? 'none' : '1px solid var(--line)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        fontSize: 14,
                        lineHeight: 1.7,
                      }}
                    >
                      {m.role === 'assistant' ? (
                        <MarkdownView content={m.text} style={{ color: m.isError ? 'var(--red)' : '#15252b' }} />
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                      )}
                    </div>
                    {m.model && (
                      <span className="muted" style={{ fontSize: 11, marginTop: 4, alignSelf: 'flex-start' }}>
                        تم الرد بواسطة {m.model}
                      </span>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div style={{ alignSelf: 'flex-start', padding: '10px 14px', background: '#ffffff', borderRadius: 10, border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>المستشار الذكي يحلل بيانات المتجر لصياغة الإجابة...</span>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChat();
                }}
                style={{ display: 'flex', gap: 8 }}
              >
                <input
                  className="input"
                  style={{ flex: 1, borderRadius: 10, fontSize: 14 }}
                  type="text"
                  placeholder="اكتب استفسارك هنا (مثال: ما هو الصنف الأكثر ربحاً هذا الشهر؟ وكيف أحسن المبيعات؟)..."
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  className="btn"
                  disabled={!inputMsg.trim() || chatLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 10 }}
                >
                  <Send size={15} />
                  <span>إرسال</span>
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Deterministic Local Analysis Grid (Available to all tiers, offline-friendly) */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 10px 0', color: 'var(--text)' }}>
          المؤشرات الإحصائية المباشرة (تشغيل محلي بدون إنترنت)
        </h2>
      </div>

      <div className="grid-2">
        <InsightCard
          title="إعادة الطلب — أصناف على وشك النفاد"
          tone="amber"
          icon={<AlertTriangle size={16} />}
          empty="لا توجد أصناف قريبة من النفاد حالياً"
          rows={A.restock.map((r) => [r.name, `رصيد ${fmt(r.stock)} — يكفي ${r.cover} يوم`])}
        />
        <InsightCard
          title="الأعلى تحقيقاً للأرباح (آخر 30 يوم)"
          tone="green"
          icon={<Coins size={16} />}
          empty="لا توجد مبيعات مسجلة في هذه الفترة"
          rows={A.topProfit.map((t) => [t.name, `${money(t.profit)} · هامش ${t.margin}%`])}
        />
        <InsightCard
          title="أصناف راكدة — رأس مال محبوس"
          tone="red"
          icon={<Boxes size={16} />}
          empty="لا توجد أصناف راكدة"
          rows={A.dead.map((d) => [d.name, `رصيد ${fmt(d.stock)} بقيمة ${money(d.stock * d.costPrice)}`])}
        />
        <InsightCard
          title="هامش ربح ضعيف — ينصح بمراجعة التسعير"
          tone="amber"
          icon={<TrendingDown size={16} />}
          empty="كافة الأصناف المسعرة بهامش ربح ملائم"
          rows={A.lowMargin.map((l) => [l.name, `هامش ${l.margin}% فقط`])}
        />
        <InsightCard
          title="أكبر مديونيات العملاء — تستوجب المتابعة"
          tone="red"
          icon={<AlertTriangle size={16} />}
          empty="لا توجد مديونيات قائمة على العملاء"
          rows={A.topDebts.map((c) => [c.name, money(c.balance)])}
        />
        <InsightCard
          title="أفضل العملاء تعاملاً (آخر 30 يوم)"
          tone="green"
          icon={<CheckCircle2 size={16} />}
          empty="لا توجد مبيعات عملاء مسجلة"
          rows={A.topCustomers.map((c) => [c.name, `${money(c.sales)} في ${c.count} فاتورة`])}
        />
      </div>
    </>
  );
}

function InsightCard({ title, rows, empty, tone, icon }) {
  return (
    <div className="card" style={{ borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {icon}
        <b style={{ fontSize: 14 }}>{title}</b>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{empty}</p>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.slice(0, 8).map(([a, b], i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                borderBottom: '1px solid #eef2f3',
                paddingBottom: 6,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{a}</span>
              <span className={`badge ${tone}`} style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                {b}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function analyze(invoices, items, customers, expenses = []) {
  items = (items || []).map((it) => ({ ...it, stock: totalStock(it) }));
  const d7 = daysAgo(7), d14 = daysAgo(14), d30 = daysAgo(30);
  const sales = (invoices || []).filter((i) => i.type === 'sale' && i.status === 'active');
  const s7 = sales.filter((i) => i.day >= d7);
  const sPrev7 = sales.filter((i) => i.day >= d14 && i.day < d7);
  const s30 = sales.filter((i) => i.day >= d30);

  const count7 = s7.length;
  const sales7 = s7.reduce((s, i) => s + (i.total || 0), 0);
  const salesPrev7 = sPrev7.reduce((s, i) => s + (i.total || 0), 0);
  const trend = salesPrev7 > 0 ? Math.round(((sales7 - salesPrev7) / salesPrev7) * 100) : sales7 > 0 ? 100 : 0;

  const sales30 = s30.reduce((s, i) => s + (i.total || 0), 0);
  const profit30 = s30.reduce((s, i) => s + (i.profit || 0), 0);
  const cost30 = s30.reduce((s, i) => s + (i.lines || []).reduce((x, l) => x + (l.qty || 0) * (l.cost || 0), 0), 0);
  const marginPct = cost30 > 0 ? Math.round((profit30 / cost30) * 100) : 0;

  // Expenses in last 30 days
  const exp30 = (expenses || []).filter((e) => (e.day || '') >= d30);
  const expenses30 = exp30.reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit30 = profit30 - expenses30;

  // per-item 30-day stats
  const stat = new Map();
  for (const inv of s30) {
    for (const l of inv.lines || []) {
      const c = stat.get(l.itemId) || { qty: 0, profit: 0, lastDay: '' };
      c.qty += Number(l.qty) || 0;
      c.profit += (Number(l.qty) || 0) * ((Number(l.price) || 0) - (Number(l.cost) || 0));
      if (inv.day > c.lastDay) c.lastDay = inv.day;
      stat.set(l.itemId, c);
    }
  }

  const soldEver = new Set();
  for (const inv of sales) {
    for (const l of inv.lines || []) {
      if (inv.day >= d30) soldEver.add(l.itemId);
    }
  }

  const restock = items
    .map((it) => {
      const st = stat.get(it.id);
      const daily = st ? st.qty / 30 : 0;
      const cover = daily > 0 ? Math.round((it.stock || 0) / daily) : 999;
      return { ...it, cover };
    })
    .filter((it) => (it.stock || 0) <= (it.minStock || 0) || it.cover <= 7)
    .sort((a, b) => a.cover - b.cover);

  const dead = items
    .filter((it) => (it.stock || 0) > 0 && !soldEver.has(it.id))
    .sort((a, b) => (b.stock || 0) * (b.costPrice || 0) - (a.stock || 0) * (a.costPrice || 0));
  const deadValue = dead.reduce((s, it) => s + (it.stock || 0) * (it.costPrice || 0), 0);

  const topProfit = items
    .map((it) => {
      const st = stat.get(it.id);
      const margin = it.costPrice > 0 ? Math.round(((it.salePrice - it.costPrice) / it.costPrice) * 100) : 0;
      return { name: it.name, profit: st?.profit || 0, margin };
    })
    .filter((t) => t.profit > 0)
    .sort((a, b) => b.profit - a.profit);

  const lowMargin = items
    .map((it) => ({
      name: it.name,
      margin: it.costPrice > 0 ? Math.round(((it.salePrice - it.costPrice) / it.costPrice) * 100) : 0,
    }))
    .filter((l) => l.margin < 15 && l.margin >= 0)
    .sort((a, b) => a.margin - b.margin);

  const topDebts = (customers || []).filter((c) => (c.balance || 0) > 0).sort((a, b) => b.balance - a.balance);

  const custStat = new Map();
  for (const inv of s30) {
    const k = inv.partyName || 'نقدي';
    const c = custStat.get(k) || { name: k, sales: 0, count: 0 };
    c.sales += inv.total || 0;
    c.count++;
    custStat.set(k, c);
  }
  const topCustomers = [...custStat.values()].sort((a, b) => b.sales - a.sales);

  return {
    sales7,
    salesPrev7,
    count7,
    sales30,
    profit30,
    expenses30,
    netProfit30,
    trend,
    marginPct,
    restock,
    dead,
    deadValue,
    topProfit,
    lowMargin,
    topDebts,
    topCustomers,
  };
}
