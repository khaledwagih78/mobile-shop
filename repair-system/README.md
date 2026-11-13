# خالد لصيانة المحمول — Khaled Mobile Repair System

نظام لإدارة رحلة جهاز الصيانة كاملة من الحجز للتسليم، يربط **العميل** و**مدير المحل** و**فني الصيانة**
على قاعدة بيانات مركزية واحدة (Supabase / PostgreSQL).

> النظام ده **مستقل** عن برنامج المحل (ERP) الموجود في جذر المستودع، ومالوش أي علاقة بالحسابات أو الخزينة أو المخزون.

---

## حالة التنفيذ

| المرحلة | المحتوى | الحالة |
|---|---|---|
| 1 | هيكل المشروع + قاعدة البيانات + العلاقات + الصلاحيات (RLS) + آلة الحالات + الاختبارات | ✅ تمت |
| 2 | تسجيل الدخول (موبايل + كلمة سر **أو** إيميل + كود) وإدارة المستخدمين + موقع الويب | ✅ تمت (70 اختبار ناجح) |
| 3 | لوحة المدير + الحجوزات + الاستلام بالصور + الإيصال الإلكتروني و QR + صفحة المتابعة + كل الأجهزة + تفاصيل الجهاز | ✅ تمت (90 اختبار ناجح) |
| 4 | واجهة الفني (PWA) + التسعير + رابط الموافقة + اعتماد المدير + طلب إعادة الفحص + التسليم + كتالوج القطع | ✅ تمت (99 اختبار ناجح) |
| 5 | تطبيق العميل (Expo) + الحجز + المتابعة | ⏳ التالية |
| 6 | موافقات العميل على الإصلاح (واجهات) | ⏳ |
| 7 | إشعارات التطبيق + إرسال واتساب يدوي بضغطة (بدون WhatsApp API) | ⏳ |
| 8 | التقارير + اختبارات الأمان النهائية | ⏳ |
| 9 | النشر والتشغيل الفعلي | ⏳ |

---

## المعمارية

```
┌──────────────┐  ┌───────────────────────┐  ┌──────────────┐
│ تطبيق العميل │  │  ويب: لوحة المدير +     │  │ واجهة الفني  │
│ Expo (iOS/   │  │  الاستقبال + صفحة       │  │ (PWA على     │
│ Android)     │  │  التتبع/الإيصال/الموافقة │  │  الموبايل)   │
└──────┬───────┘  └──────────┬────────────┘  └──────┬───────┘
       │  supabase-js (anon key + JWT المستخدم)      │
       └─────────────────────┼─────────────────────┘
                             ▼
        ┌────────────────────────────────────────────┐
        │ Supabase                                   │
        │  • Auth (هاتف + OTP)                       │
        │  • PostgreSQL: الجداول + RLS + آلة الحالات   │
        │    كل الكتابة عبر RPC (SECURITY DEFINER)     │
        │  • Realtime (تحديث لحظي)                    │
        │  • Storage (صور الأجهزة — bucket خاص)       │
        │  • Edge Functions:                          │
        │      admin-reset-password (مرحلة 2)         │
        │      push dispatcher → FCM (مرحلة 7)        │
        └────────────────────────────────────────────┘
```

### تسجيل الدخول (بدون SMS أو واتساب API) — طريقتين والعميل يختار

| الطريقة | إزاي | نسيت؟ |
|---|---|---|
| 📱 موبايل + كلمة سر | زي أي تطبيق | الأدمن يعيّن كلمة جديدة |
| ✉️ إيميل + كود | يوصله كود 6 أرقام على الإيميل (صالح 10 دقائق) | مفيش كلمة سر أصلاً |

- في الطريقتين رقم الموبايل إجباري، و**كل رقم ليه حساب واحد بس** (مش ممكن نفس الشخص يبقى عنده حسابين).
- الإيميل بيثبت ملكية الإيميل **مش** الموبايل، فقواعد الربط بأجهزة المحل (تحت) واحدة للطريقتين.
- **طريقة الموبايل:** داخليًا Supabase Auth بياخد إيميل مشتق من الرقم
  (`201xxxxxxxxx@phone.kmr.invalid`). الامتداد `.invalid` محجوز عالميًا ومستحيل يستقبل إيميل،
  فمحدش يقدر يسرق حساب عن طريق "نسيت كلمة السر".
- **نسيت كلمة السر:** الأدمن يعيّن كلمة جديدة من شاشة المستخدمين (Edge Function `admin-reset-password`).
- **لأن الرقم مش متأكَّد منه بـ OTP:** الحساب الجديد عمره ما يترَبط تلقائيًا بأجهزة سجّلها المحل بنفس الرقم. الربط بيحصل بس:
  1. العميل يلصق رابط إيصال الاستلام بتاعه (رمز سري) والرقم يطابق، أو
  2. الموظف يتأكد وجهًا لوجه: استلام حجز من التطبيق = توثيق تلقائي، وفي الـ walk-in لو الرقم عليه حساب غير موثّق
     النظام بيطلب من الموظف يختار **توثيق** (الحساب بتاعه) أو **فصل** (مش بتاعه).
- **قيد معروف:** أي حد يقدر يسجل برقم مش بتاعه (الموبايل مش متأكَّد منه في الطريقتين)، لكنه مش هيشوف أي بيانات. لو صاحب الرقم الحقيقي اشتكى،
  الأدمن يوقف الحساب ده. إضافة SMS OTP بعدين = تغيير إعدادات بس.

### قرارات تصميم مهمة

1. **الحماية في قاعدة البيانات مش في الواجهة.** العملاء والموظفين ليهم صلاحية `SELECT` بس (مفلترة بـ RLS)؛
   أي كتابة لازم تعدي على دالة RPC بتعيد التحقق من الدور والفرع والفني المسند.
2. **آلة الحالات على الخادم.** جدول `status_transitions` فيه الانتقالات القانونية بس، ومين مسموح له بكل انتقال.
   Trigger على `repair_orders` بيرفض أي انتقال غير قانوني **حتى لو من SQL Editor أو service role**.
3. **العميل عمره ما يقرأ `repair_orders`.** بيقرأ جدول عرض آمن `customer_tracking` (من غير الفني ولا الملاحظات الداخلية)،
   وده الجدول اللي بيتبث على Realtime لشاشة المتابعة.
4. **سجلات لا يمكن التلاعب بها:** `repair_status_history` و`audit_logs` ممنوع تعديلهم أو حذفهم (حتى TRUNCATE)،
   `customer_approvals` ممنوع حذفها والموافقة بعد الرد ما تتغيرش، وسجل الفنيين بيتقفل ومايتمسحش.
5. **Idempotency:** العمليات الحساسة بتاخد `idempotency_key`؛ إعادة الإرسال (انقطاع نت / ضغطتين) بترجع نفس النتيجة الأولى.
6. **Optimistic concurrency:** كل طلب عليه `version`؛ لو شاشتين عدّلوا في نفس الوقت، التانية بتاخد `VERSION_CONFLICT`.
7. **رقم الطلب** `KMR-2026-000001` بيتولد في قاعدة البيانات لحظة استلام الجهاز بعدّاد سنوي ذرّي (مستحيل يتكرر).
8. **رمز قفل الجهاز** متشفر (`pgp_sym_encrypt`) والعمود نفسه مش متاح للقراءة؛ بيظهر للفني المسند أو المدير بس عن طريق RPC وكل مرة بتتسجل في التدقيق.
9. **رابط الموافقة من واتساب:** رمز عشوائي بصلاحية محددة (افتراضي 72 ساعة)، مخزّن كـ SHA-256 بس،
   ولازم العميل يدخل **آخر 4 أرقام من تليفونه** (تحقق إضافي).
10. **الإشعارات:** كل تغيير حالة بيضيف إشعار في طابور (`notifications` + `notification_logs`) بمفتاح `dedupe_key` فريد،
    فمستحيل نفس الحدث يتبعت مرتين. الإرسال الفعلي (واتساب/FCM) + إعادة المحاولة في مرحلة 7.
11. **الفروع:** كل جدول تشغيلي فيه `branch_id` والصلاحيات بتفلتر بالفرع؛ دلوقتي فرع واحد "محل خالد".

### دورة حالات الجهاز

```
NEW_REQUEST ─► BOOKING_CONFIRMED ─► DEVICE_RECEIVED ─► UNDER_DIAGNOSIS ─► WAITING_CUSTOMER_APPROVAL
     │                 │                                                     │            │
     └──► CANCELLED ◄──┘                                         CUSTOMER_APPROVED   CUSTOMER_REJECTED
                                                                         │                │
                                     WAITING_SPARE_PART ◄──► UNDER_REPAIR ◄┘                │
                                                                │                         │
                                                         UNDER_TESTING                    │
                                                                │                         │
                                                  WAITING_MANAGER_APPROVAL                │
                                                                │ (المدير فقط)             │
                                                         READY_FOR_PICKUP ◄───────────────┘
                                                                │ (المدير فقط)
                                                            DELIVERED
```
الجدول الكامل بالأدوار في `supabase/migrations/20261113000002_helpers_state_machine.sql` ونسخته للواجهات في `packages/shared/src/index.ts`.

---

## هيكل المشروع

```
repair-system/
├── supabase/
│   ├── config.toml                  إعدادات Supabase CLI (OTP، Storage، Realtime)
│   ├── migrations/
│   │   ├── …001_core_schema.sql     الجداول الـ 20 + العلاقات + الفهارس
│   │   ├── …002_helpers_state_machine.sql  دوال الأدوار، آلة الحالات، الحماية من التعديل، التدقيق، طابور الإشعارات
│   │   ├── …003_rls_policies.sql    Row Level Security لكل جدول
│   │   ├── …004_rpc_business_ops.sql  كل عمليات النظام (حجز، استلام، تعيين، فحص، تسعير، موافقة، تسليم…)
│   │   └── …005_storage_realtime.sql  bucket الصور الخاص + Realtime
│   ├── seed.sql                     الفرع الافتراضي "محل خالد" + الشروط (بدون بيانات وهمية)
│   └── tests/supabase_shim.sql      للاختبار فقط: محاكاة auth/storage على PostgreSQL عادي
├── supabase/functions/admin-reset-password/  Edge Function لتعيين كلمة سر من الأدمن
├── apps/web/                        موقع Next.js (المدير/الاستقبال/الفني PWA/العميل)
├── docs/manager-guide.md           دليل استخدام المدير والاستقبال
├── docs/technician-guide.md        دليل استخدام الفني
├── packages/shared/                 الحالات والترجمة والانتقالات ورسائل الأخطاء (مشترك ويب/موبايل)
├── tests/db/                        اختبارات قاعدة البيانات الحقيقية (Vitest + pg)
├── scripts/pg-local.sh              تشغيل PostgreSQL محلي للاختبار بدون Docker
└── .env.example
```

### الجداول

`branches` · `profiles` · `customers` · `employees` · `devices` · `bookings` · `repair_orders` ·
`repair_status_history` · `technician_assignments` · `diagnostics` · `spare_parts` · `repair_parts` ·
`customer_approvals` · `notifications` · `notification_logs` · `device_media` · `handover_records` ·
`audit_logs` · `customer_reviews` · `repair_settings`
+ مساعدة: `status_transitions` · `customer_tracking` · `push_tokens` · `private.idempotency_keys` · `private.order_counters`

---

## التشغيل المحلي

### 1) اختبارات قاعدة البيانات (من غير Docker)

محتاج Node 20+ و PostgreSQL 15/16 متسطب على الجهاز.

```bash
cd repair-system
npm install
npm test          # بيشغّل Postgres محلي على 54329، يطبّق كل الـ migrations، ويشغّل 99 اختبار
npm run db:stop   # لإيقاف قاعدة الاختبار
```

لو عندك Postgres شغال في مكان تاني: `TEST_DATABASE_URL=postgres://user@host:port/postgres npm test`

### 2) Supabase كامل محليًا (يحتاج Docker)

```bash
npm i -g supabase
cd repair-system
supabase start          # بيطبّق migrations + seed تلقائيًا
supabase status         # هيطبعلك API URL و anon key
```

### 3) موقع الويب

```bash
cp .env.example apps/web/.env.local   # واملأ NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run web:dev                       # http://localhost:3000
```

### إعدادات لازمة في Supabase Dashboard (مرة واحدة)

1. **Authentication → Sign In / Providers → Email:** مفعّل، و **Confirm email: OFF** (حسابات الموبايل إيميلها داخلي)،
   و **Email OTP Length = 6** و **Email OTP Expiration = 600** ثانية.
2. **Authentication → Sign In / Providers → Phone:** سيبه مقفول (مش محتاجينه).
3. **Authentication → Emails → Templates:** في قالبي **Magic Link** و **Confirm signup** حط محتوى
   `supabase/templates/otp_code.html` (لازم يكون فيه `{{ .Token }}` عشان يبعت كود مش رابط).
4. **Authentication → Emails → SMTP Settings:** فعّل SMTP خاص — إيميل Supabase الافتراضي للتجربة بس وعدده محدود جدًا.
   - **Brevo** (مجاني 300 إيميل/يوم): Host `smtp-relay.brevo.com` · Port `587` · User/Password من حساب Brevo → SMTP & API.
   - أو **Gmail** باسم المحل: Host `smtp.gmail.com` · Port `587` · User = الإيميل · Password = App Password (مش كلمة سر الجيميل).
5. انشر دالة تغيير كلمة السر: `supabase functions deploy admin-reset-password`

### 4) أول حساب أدمن (مرة واحدة)

1. اعمل حساب من صفحة الدخول في الموقع برقم موبايلك (هيتعمل حساب عميل عادي).
2. من **Supabase → SQL Editor** شغّل (بعد ما تحط رقمك):

```sql
update public.profiles
   set role = 'ADMIN', branch_id = (select id from public.branches where code = 'MAIN')
 where phone = '+201XXXXXXXXX';
update public.customers set profile_id = null, deleted_at = now()
 where profile_id = (select id from public.profiles where phone = '+201XXXXXXXXX');
insert into public.employees (profile_id, branch_id)
select id, branch_id from public.profiles where phone = '+201XXXXXXXXX';
```

3. بعد كده أي موظف/فني: يعمل حساب من صفحة الدخول، وإنت تغيّر دوره من **إدارة المستخدمين**.

---

## النشر على Supabase (قاعدة البيانات)

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push          # يطبّق الـ migrations بالترتيب
psql "<DB_URL>" -f supabase/seed.sql
```

> ⚠️ لا ترفع `supabase/tests/supabase_shim.sql` على المشروع الحقيقي — ده للاختبار المحلي بس.
