# 08 — AI Architecture & Subscription Tiers

## 1. Overview

The ERP integrates Google Gemini AI as an intelligent business analyst and conversational advisor. The implementation follows three fundamental security and architectural principles:

1. **User-Locked Configuration**: The AI API key cannot be viewed, edited, or modified by the user from the application UI. It is managed strictly through environment configuration (`.env`).
2. **Strict Analyze-Only Sandbox**: The AI operates exclusively in read-only analysis mode. It has **ZERO** capability to create, edit, update, or delete records in the database.
3. **Tiered Subscription System**: Features are partitioned into **Free (without AI)** and **Pro (with AI)** tiers.

---

## 2. Model & API Integration

- **Primary Model**: `gemini-3.5-flash-lite` (Google Gemini 3.5 Flash-Lite).
- **Fallback Models**: `gemini-2.0-flash`, `gemini-1.5-flash` (automatic fallback if a model endpoint is unreachable or deprecated).
- **Service Location**: `src/services/gemini.js`
- **Environment Variables**:
  ```env
  VITE_GEMINI_API_KEY=your-gemini-api-key
  VITE_GEMINI_MODEL=gemini-3.5-flash-lite
  ```

### Why the User Cannot Change the Key
To prevent disruption, unauthorized key sharing, or API rate exhaustion, the API key input field was removed from `Settings.jsx`. The application reads `VITE_GEMINI_API_KEY` from `import.meta.env` with an optional fallback to legacy internal settings.

---

## 3. Strict Analyze-Only Mode

The AI performs comprehensive business diagnostics by analyzing everything that happened in the store:

- Sales performance (last 7 days, last 30 days, comparative trends).
- Estimated profits, expenses, net profits, and profit margins.
- Inventory health: items needing urgent reorder, dead stock with capital locked up.
- Customer debt exposure and top debtor aging.
- Best customer transaction frequency and volume.

### Guarantees
- **No DB Mutations**: The AI service (`src/services/gemini.js`) receives pre-aggregated JavaScript data objects. It does not import or execute `db.invoices.put`, `db.items.add`, `db.delete`, etc.
- **System Instruction Enforcement**: Every prompt explicitly instructs Gemini:
  > *"أنت مستشار أعمال وتحليلي فقط (Strict Analyze-Only). لا تملك أي صلاحية لتعديل أو إضافة أو حذف أي بيانات في النظام."*
- **Clear UI Indicators**: All AI sections display the shield badge:
  `وضع التحليل فقط (Analyze-Only) — الذكاء الاصطناعي للقراءة والتشخيص فقط دون تعديل أو حذف البيانات.`

---

## 4. AI Store Advisor Chatbot

Located in `src/pages/Insights.jsx`, the interactive Chatbot allows store owners to ask natural-language questions about their business in Arabic.

### Capabilities:
- Full conversation history within the session.
- Pre-populated with the store's complete operational context.
- Quick single-click prompts (e.g. *ما هي الأصناف الأكثر ربحية؟*, *كيف أتعامل مع البضاعة الراكدة؟*, *من هم أكبر المدينين؟*).
- Safe redirect: If a user asks the AI to edit an item or delete an invoice, the advisor politely explains its analyze-only nature and guides them to the proper screen.

---

## 5. Subscription Tiers (Free vs Pro)

The subscription architecture is defined in `src/plans.js` and displayed in `src/pages/Settings.jsx`:

| Feature | Free Plan (مجانية) | Pro Plan (احترافية) |
|---|---|---|
| **Monthly Cost** | 0 EGP | Commercial Subscription |
| **Sales, POS & Invoicing** | Included | Included |
| **Inventory & Barcodes** | Included | Included |
| **Customers & Suppliers** | Included | Included |
| **Expenses & Cash Drawer** | Included | Included |
| **Basic Local Analytics** | Included (Offline cards) | Included |
| **Google Gemini AI Analysis** | **Not Included** | **Included** |
| **AI Advisor Chatbot** | **Not Included** | **Included** |
| **Smart Import OCR with AI** | **Not Included** | **Included** |
| **Advanced Accounting & Treasury** | Not Included | Included |
| **Installments & Credit Center** | Not Included | Included |

### Upgrade Flow
- When a user on the **Free** tier visits `/insights`, the system displays a Pro upgrade banner explaining the AI features with a button linking to `/settings`.
- The local deterministic statistics (reorder alerts, dead stock valuation, debt tables) remain functional offline for all users.
