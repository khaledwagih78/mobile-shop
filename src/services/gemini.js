// ---------- Google Gemini AI Service ----------
// Architecture: Strict Analyze-Only (Read-Only)
// The AI receives aggregated business summaries for analysis and advisory only.
// It has ZERO access or capability to mutate, create, edit, or delete any records in the database.
// The API key is securely loaded from environment variables and cannot be altered by the user from the UI.

import { getSetting } from '../db';

const PRIMARY_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

export async function getGeminiApiKey() {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envKey && String(envKey).trim()) {
    return String(envKey).trim();
  }
  // Fallback to internal saved setting if previously populated
  const savedKey = await getSetting('aiKey', '');
  return String(savedKey || '').trim();
}

export async function isGeminiConfigured() {
  const key = await getGeminiApiKey();
  return Boolean(key);
}

// Executes a prompt against Gemini API with automatic model fallback if a model is unsupported
async function callGeminiApi({ contents, systemInstruction, temperature = 0.3 }) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('مفتاح Google Gemini API غير مهيأ في إعدادات النظام (.env).');
  }

  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = {
        contents,
        generationConfig: {
          temperature,
        },
      };

      if (systemInstruction) {
        payload.systemInstruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errMsg = String(data.error?.message || `HTTP ${res.status}`);
        const lowerErr = errMsg.toLowerCase();
        // If model not found (404), deprecated, or no longer available, try next model in fallback list
        const isModelUnavailable =
          res.status === 404 ||
          lowerErr.includes('not found') ||
          lowerErr.includes('unsupported') ||
          lowerErr.includes('no longer available') ||
          lowerErr.includes('deprecated') ||
          lowerErr.includes('not supported') ||
          lowerErr.includes('not available');

        if (isModelUnavailable) {
          lastError = new Error(`النموذج ${model} غير متوفر: ${errMsg}`);
          continue;
        }
        throw new Error(errMsg);
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { text, modelUsed: model };
    } catch (err) {
      lastError = err;
      const lower = String(err.message || '').toLowerCase();
      // If error indicates model is unavailable or 404, allow trying next model
      if (
        lower.includes('not found') ||
        lower.includes('404') ||
        lower.includes('no longer available') ||
        lower.includes('unsupported') ||
        lower.includes('deprecated')
      ) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('تعذر الاتصال بخدمة Google Gemini API.');
}

/**
 * Analyze everything that happened in the store.
 * Strict Read-Only: receives aggregated metrics, outputs structured strategic advice.
 */
export async function analyzeStoreData(summary) {
  const systemInstruction = `أنت "المستشار المالي والتشغيلي الذكي" لنظام إدارة المتاجر والمخزون والحسابات (ERP).

طبيعة دورك وصلاحياتك:
1. دورك استشاري وتحليلي حصراً (Strict Read-Only). ليس لديك أي قدرة أو صلاحية لتعديل أو إضافة أو حذف أي بيانات في قاعدة البيانات أو النظام.
2. إذا سُئلت عن تعديل مخزون أو حذف فاتورة أو إضافة دفعة، وجّه المستخدم للشاشة المخصصة في النظام.

قواعد الدقة ومنع التخمين:
1. استند بنسبة 100% إلى الأرقام والبيانات المرفقة لك في سياق الجلسة.
2. الأمانة الرقمية: إذا كانت معلومة معينة غير مذكورة في البيانات، قل بصراحة تامة: "هذه المعلومة غير متوفرة في سجلات النظام الحالية"، ولا تختلق أرقاماً أو أسماء عملاء أو أصناف غير موجودة.
3. حالة النظام الجديد: إذا كانت المبيعات والأرباح 0 أو فارغة، فهذا يعني أن المتجر جديد أو لم تبدأ المبيعات بعد؛ لا تفترض حدوث ركود أو أزمة، بل اشرح بهدوء أن النظام بانتظار تسجيل العمليات الأولى.

طريقة الرد (موجزة، عملية، وعالية الجودة بدون إسهاب إنشائي):
نظّم تحليلك دائماً في 4 أقسام واضحة مدعومة بالأرقام والنسب:
1. 📊 نبض النشاط والسيولة: تقييم مباشر لحجم المبيعات، هامش الربح، والمصروفات وصافي الأرباح.
2. ⚠️ تشخيص المخزون: أصناف تتطلب إعادة طلب عاجلة، وقيمة رأس المال المحبوس في البضاعة الراكدة.
3. 👥 موقف الديون والتحصيل: أكبر المديونيات المعلقة على العملاء وتوصيات التحصيل.
4. 🎯 5 قرارات فورية مقترحة: خطوات عملية محددة قابلة للتنفيذ الفوري من قِبل الإدارة.`;

  const prompt = `إليك ملخص النشاط الفعلي للمنشأة من واقع سجلات الـ ERP:\n\n${JSON.stringify(summary, null, 2)}\n\nالمطلوب: قدّم تقرير التحليل المالي والتشغيلي المباشر وفق التنسيق المحدد.`;

  const res = await callGeminiApi({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    temperature: 0.25,
  });

  return res;
}

/**
 * AI Store Advisor Chatbot.
 * Allows the user to ask anything about what happened in the store.
 * Strict Read-Only: answers questions based on business data.
 */
export async function chatWithStoreAdvisor({ message, history = [], storeSummary = {} }) {
  const systemInstruction = `أنت "المستشار الذكي" للمتجر في نظام ERP، مدعوم بنموذج Google Gemini.
دورك تحليلي واستشاري وتفاعلي فقط (Strict Read-Only).
أنت لا تملك أي صلاحية لتعديل، إضافة، أو حذف أي بيانات في النظام، ولا يمكنك إجراء معاملات بيع أو شراء أو شطب.

مهمتك وقواعدك:
- أجب عن استفسارات صاحب المتجر بالاعتماد حصراً على بيانات المتجر المرفقة في سياق الجلسة.
- الصدق والأمانة: إذا كانت المعلومة غير موجودة في بيانات المتجر أدناه أو لا تعرف إجابتها، قل بصراحة تامة: "لا أعلم / لا تتوفر هذه المعلومة في سجلات النظام الحالية". لا تخترع بيانات أو أصناف أو عملاء.
- إذا كانت البيانات فارغة (لا توجد فواتير أو أصناف)، أخبر المستخدم بلطف أن النظام بانتظار تسجيل أولى العمليات للإجابة عن أسئلته.
- إذا طلب منك المستخدم تعديل صنف أو حذف فاتورة، وضّح له بلطف أنك مستشار تحليلي فقط ووجهه للشاشة المناسبة للقيام بذلك بنفسه.
- اكتب دائماً بلغة عربية سليمة ومريحة ومختصرة ومهنية، مع الاستشهاد بالأرقام والنسب المئوية عند توفرها.

سياق بيانات المتجر الحالية:
${JSON.stringify(storeSummary, null, 2)}`;

  // Convert history format to Gemini format if provided
  const contents = [];
  for (const h of history) {
    contents.push({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.text }],
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: message }],
  });

  const res = await callGeminiApi({
    systemInstruction,
    contents,
    temperature: 0.35,
  });

  return res;
}
