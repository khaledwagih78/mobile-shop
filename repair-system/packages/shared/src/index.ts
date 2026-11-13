// =====================================================================
// @kmr/shared — أنواع وثوابت مشتركة بين الويب (Next.js) والموبايل (Expo).
// الحالات والانتقالات هنا مرآة لقاعدة البيانات (status_transitions)؛
// قاعدة البيانات هي المرجع والحماية الفعلية، وده للعرض فقط.
// اختبار tests/db/shared-sync.test.ts يتأكد إن الاتنين متطابقين.
// =====================================================================

export type AppRole = 'ADMIN' | 'MANAGER' | 'RECEPTIONIST' | 'TECHNICIAN' | 'CUSTOMER';

export const REPAIR_STATUSES = [
  'NEW_REQUEST',
  'BOOKING_CONFIRMED',
  'DEVICE_RECEIVED',
  'UNDER_DIAGNOSIS',
  'WAITING_CUSTOMER_APPROVAL',
  'CUSTOMER_APPROVED',
  'CUSTOMER_REJECTED',
  'WAITING_SPARE_PART',
  'UNDER_REPAIR',
  'UNDER_TESTING',
  'WAITING_MANAGER_APPROVAL',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'CANCELLED',
] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

export const STATUS_LABELS: Record<RepairStatus, string> = {
  NEW_REQUEST: 'طلب جديد',
  BOOKING_CONFIRMED: 'تم تأكيد الحجز',
  DEVICE_RECEIVED: 'تم استلام الجهاز',
  UNDER_DIAGNOSIS: 'تحت الفحص',
  WAITING_CUSTOMER_APPROVAL: 'انتظار موافقة العميل',
  CUSTOMER_APPROVED: 'تمت الموافقة',
  CUSTOMER_REJECTED: 'تم رفض الإصلاح',
  WAITING_SPARE_PART: 'انتظار قطعة غيار',
  UNDER_REPAIR: 'تحت الصيانة',
  UNDER_TESTING: 'تحت الاختبار',
  WAITING_MANAGER_APPROVAL: 'انتظار اعتماد المدير',
  READY_FOR_PICKUP: 'جاهز للاستلام',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
};

/** Actor tokens: a role name or ASSIGNED_TECH (the currently assigned technician). */
export type TransitionActor = AppRole | 'ASSIGNED_TECH';

export interface Transition {
  from: RepairStatus;
  to: RepairStatus;
  actors: TransitionActor[];
  /** When set, only this server RPC may perform the transition. */
  viaRpc: string | null;
}

const F: TransitionActor[] = ['ADMIN', 'MANAGER', 'RECEPTIONIST'];
const M: TransitionActor[] = ['ADMIN', 'MANAGER'];
const T: TransitionActor[] = ['ASSIGNED_TECH'];

export const TRANSITIONS: Transition[] = [
  { from: 'NEW_REQUEST', to: 'BOOKING_CONFIRMED', actors: F, viaRpc: 'confirm_booking' },
  { from: 'NEW_REQUEST', to: 'DEVICE_RECEIVED', actors: F, viaRpc: 'receive_device' },
  { from: 'NEW_REQUEST', to: 'CANCELLED', actors: [...F, 'CUSTOMER'], viaRpc: 'cancel_booking' },
  { from: 'BOOKING_CONFIRMED', to: 'DEVICE_RECEIVED', actors: F, viaRpc: 'receive_device' },
  { from: 'BOOKING_CONFIRMED', to: 'CANCELLED', actors: [...F, 'CUSTOMER'], viaRpc: 'cancel_booking' },
  { from: 'DEVICE_RECEIVED', to: 'UNDER_DIAGNOSIS', actors: T, viaRpc: null },
  { from: 'DEVICE_RECEIVED', to: 'READY_FOR_PICKUP', actors: M, viaRpc: null },
  { from: 'UNDER_DIAGNOSIS', to: 'WAITING_CUSTOMER_APPROVAL', actors: M, viaRpc: 'send_quote' },
  { from: 'UNDER_DIAGNOSIS', to: 'READY_FOR_PICKUP', actors: M, viaRpc: null },
  { from: 'WAITING_CUSTOMER_APPROVAL', to: 'CUSTOMER_APPROVED', actors: ['CUSTOMER', ...F], viaRpc: 'respond_quote' },
  { from: 'WAITING_CUSTOMER_APPROVAL', to: 'CUSTOMER_REJECTED', actors: ['CUSTOMER', ...F], viaRpc: 'respond_quote' },
  { from: 'WAITING_CUSTOMER_APPROVAL', to: 'UNDER_DIAGNOSIS', actors: M, viaRpc: 'withdraw_quote' },
  { from: 'CUSTOMER_APPROVED', to: 'UNDER_REPAIR', actors: T, viaRpc: null },
  { from: 'CUSTOMER_APPROVED', to: 'WAITING_SPARE_PART', actors: [...T, ...M], viaRpc: null },
  { from: 'CUSTOMER_REJECTED', to: 'READY_FOR_PICKUP', actors: M, viaRpc: null },
  { from: 'CUSTOMER_REJECTED', to: 'WAITING_CUSTOMER_APPROVAL', actors: M, viaRpc: 'send_quote' },
  { from: 'WAITING_SPARE_PART', to: 'UNDER_REPAIR', actors: T, viaRpc: null },
  { from: 'WAITING_SPARE_PART', to: 'WAITING_CUSTOMER_APPROVAL', actors: M, viaRpc: 'send_quote' },
  { from: 'UNDER_REPAIR', to: 'WAITING_SPARE_PART', actors: [...T, ...M], viaRpc: null },
  { from: 'UNDER_REPAIR', to: 'UNDER_TESTING', actors: T, viaRpc: null },
  { from: 'UNDER_REPAIR', to: 'UNDER_DIAGNOSIS', actors: [...T, ...M], viaRpc: null },
  { from: 'UNDER_REPAIR', to: 'WAITING_CUSTOMER_APPROVAL', actors: M, viaRpc: 'send_quote' },
  { from: 'UNDER_TESTING', to: 'UNDER_REPAIR', actors: T, viaRpc: null },
  { from: 'UNDER_TESTING', to: 'WAITING_MANAGER_APPROVAL', actors: T, viaRpc: 'finish_repair' },
  { from: 'WAITING_MANAGER_APPROVAL', to: 'READY_FOR_PICKUP', actors: M, viaRpc: 'approve_completion' },
  { from: 'WAITING_MANAGER_APPROVAL', to: 'UNDER_REPAIR', actors: M, viaRpc: 'request_recheck' },
  { from: 'WAITING_MANAGER_APPROVAL', to: 'UNDER_DIAGNOSIS', actors: M, viaRpc: 'request_recheck' },
  { from: 'READY_FOR_PICKUP', to: 'DELIVERED', actors: M, viaRpc: 'deliver_device' },
];

/** Next statuses the given actor may move to through the generic change_repair_status RPC. */
export function genericNextStatuses(
  from: RepairStatus,
  role: AppRole,
  isAssignedTech: boolean,
): RepairStatus[] {
  return TRANSITIONS.filter(
    (t) =>
      t.from === from &&
      t.viaRpc === null &&
      (t.actors.includes(role) || (isAssignedTech && t.actors.includes('ASSIGNED_TECH'))),
  ).map((t) => t.to);
}

/** Server error codes -> Arabic messages for the UI. */
export const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'ليس لديك صلاحية لتنفيذ هذه العملية',
  FORBIDDEN_BRANCH: 'هذا الطلب تابع لفرع آخر',
  FORBIDDEN_TRANSITION: 'لا يمكنك نقل الجهاز لهذه المرحلة',
  INVALID_TRANSITION: 'لا يمكن الانتقال لهذه المرحلة من المرحلة الحالية',
  TRANSITION_REQUIRES_RPC: 'هذه الخطوة تتم من شاشتها المخصصة فقط',
  VERSION_CONFLICT: 'تم تعديل الطلب من مستخدم آخر، تم تحديث البيانات — حاول مرة أخرى',
  ORDER_NOT_FOUND: 'طلب الصيانة غير موجود',
  BOOKING_NOT_FOUND: 'الحجز غير موجود',
  BOOKING_NOT_OPEN: 'الحجز مغلق بالفعل',
  BOOKING_NOT_PENDING: 'الحجز ليس في انتظار التأكيد',
  ASSIGNMENT_NOT_ACCEPTED: 'يجب استلام الجهاز إلكترونيًا أولاً',
  APPROVAL_NOT_PENDING: 'تم الرد على هذا العرض من قبل',
  APPROVAL_EXPIRED: 'انتهت صلاحية رابط الموافقة، تواصل مع المحل',
  APPROVAL_NOT_FOUND: 'طلب الموافقة غير موجود',
  IDENTITY_CHECK_FAILED: 'آخر 4 أرقام من الهاتف غير صحيحة',
  TEST_NOT_PASSED: 'يجب تسجيل نتيجة اختبار ناجحة قبل إنهاء الصيانة',
  REPORT_REQUIRED: 'اكتب تقرير الإصلاح',
  ORDER_NOT_READY: 'الجهاز ليس جاهزًا للتسليم',
  INVALID_PHONE: 'رقم الهاتف غير صحيح',
  NAME_REQUIRED: 'الاسم مطلوب',
  ISSUE_REQUIRED: 'اكتب وصف العطل',
  ALREADY_REVIEWED: 'تم تقييم هذا الطلب من قبل',
  NOT_AUTHENTICATED: 'سجّل الدخول أولاً',
  UNVERIFIED_ACCOUNT_DECISION_REQUIRED: 'العميل ده عنده حساب على التطبيق غير موثّق — اختار: الحساب بتاعه (توثيق) أو مش بتاعه (فصل)',
  CLAIM_NOT_FOUND: 'رابط الإيصال غير صحيح',
  CLAIM_PHONE_MISMATCH: 'رقم الموبايل في الإيصال مختلف عن رقم حسابك',
  CLAIM_ALREADY_LINKED: 'بيانات الإيصال مربوطة بحساب آخر — تواصل مع المحل',
  ALREADY_LINKED: 'حسابك مربوط بالفعل',
  CANNOT_DEMOTE_SELF: 'لا يمكنك تغيير صلاحيتك بنفسك',
  CANNOT_DEACTIVATE_SELF: 'لا يمكنك إيقاف حسابك بنفسك',
  PROFILE_NOT_FOUND: 'المستخدم غير موجود',
  INVALID_CREDENTIALS: 'رقم الموبايل أو كلمة السر غير صحيحة',
  USER_EXISTS: 'الرقم ده مسجّل قبل كده — سجّل دخول',
  WEAK_PASSWORD: 'كلمة السر لازم تكون 8 حروف/أرقام على الأقل',
};

/** Extract the error code from a Postgres/Supabase error message ("CODE: details"). */
export function errorCode(message: string | undefined | null): string {
  if (!message) return 'UNKNOWN';
  const m = /^([A-Z_]+)/.exec(message.trim());
  return m ? m[1] : 'UNKNOWN';
}

export function arabicError(message: string | undefined | null): string {
  return ERROR_MESSAGES[errorCode(message)] ?? 'حدث خطأ غير متوقع، حاول مرة أخرى';
}

/** Egyptian phone normalization (mirror of private.normalize_phone). */
export function normalizePhone(p: string): string {
  const raw = p.replace(/[^0-9+]/g, '');
  const digits = p.replace(/[^0-9]/g, '');
  if (/^01[0-9]{9}$/.test(raw)) return '+2' + digits;
  if (raw.startsWith('00')) return '+' + digits.slice(2);
  if (raw.startsWith('+')) return raw;
  return '+' + digits;
}

// ---------------------------------------------------------------------
// Auth without SMS/WhatsApp OTP: phone + password.
// Supabase Auth gets an internal e-mail derived from the phone. The domain
// uses the reserved ".invalid" TLD (RFC 2606) so no e-mail can ever be
// delivered there -> password-reset e-mails cannot be hijacked.
// ---------------------------------------------------------------------
export const AUTH_EMAIL_DOMAIN = 'phone.kmr.invalid';

/** 01xxxxxxxxx (Egyptian mobile) in any common format. */
export function isEgyptMobile(p: string): boolean {
  return /^\+201[0125][0-9]{8}$/.test(normalizePhone(p));
}

export function phoneToAuthEmail(p: string, domain = AUTH_EMAIL_DOMAIN): string {
  return normalizePhone(p).replace(/[^0-9]/g, '') + '@' + domain;
}

/** Display a normalized phone as 01xxxxxxxxx. */
export function displayPhone(p: string | null | undefined): string {
  if (!p) return '';
  return p.startsWith('+20') ? '0' + p.slice(3) : p;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: 'مدير النظام',
  MANAGER: 'مدير الفرع',
  RECEPTIONIST: 'موظف استقبال',
  TECHNICIAN: 'فني صيانة',
  CUSTOMER: 'عميل',
};

/** Landing route after login per role. */
export function homeForRole(role: AppRole | null | undefined): string {
  switch (role) {
    case 'ADMIN':
    case 'MANAGER':
    case 'RECEPTIONIST':
      return '/staff';
    case 'TECHNICIAN':
      return '/tech';
    case 'CUSTOMER':
      return '/account';
    default:
      return '/login';
  }
}

/** Map Supabase Auth error messages to our codes. */
export function authErrorCode(message: string | undefined | null): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'INVALID_CREDENTIALS';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('profiles_phone_uidx')) return 'USER_EXISTS';
  if (m.includes('password') && (m.includes('at least') || m.includes('weak'))) return 'WEAK_PASSWORD';
  return errorCode(message);
}
