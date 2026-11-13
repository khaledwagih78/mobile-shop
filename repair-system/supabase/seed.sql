-- =====================================================================
-- Production seed: the single default branch + its settings.
-- No fake customers / orders here (demo data lives in supabase/demo_seed.sql).
-- =====================================================================
insert into public.branches (code, name, phone, whatsapp, address)
values ('MAIN', 'محل خالد', null, null, null)
on conflict (code) do nothing;

insert into public.repair_settings (branch_id, receipt_terms, warranty_terms)
select b.id,
  E'1. يلتزم المحل بالحفاظ على الجهاز طوال فترة وجوده بالمحل.\n'
  || E'2. لا يتحمل المحل مسؤولية البيانات المخزنة على الجهاز؛ يُنصح بعمل نسخة احتياطية.\n'
  || E'3. لا يتم البدء في أي إصلاح إلا بعد موافقة العميل على التكلفة.\n'
  || E'4. يُرجى استلام الجهاز خلال 30 يومًا من إشعار الجاهزية.\n'
  || E'5. يتم التسليم لصاحب الجهاز أو من يحمل رقم الطلب مع التحقق من رقم الهاتف.',
  E'الضمان يشمل القطعة التي تم تغييرها وعيوب التركيب فقط خلال مدة الضمان المذكورة،\n'
  || E'ولا يشمل الكسر أو السوائل أو سوء الاستخدام أو فتح الجهاز خارج المحل.'
from public.branches b where b.code = 'MAIN'
on conflict (branch_id) do nothing;
