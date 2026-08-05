/**
 * Mailbox local-part rules for Lemon Mail.
 *
 * - RFC 2142 / operational role addresses (must not be self-registered)
 * - Well-known brand / mail-provider names (anti-impersonation)
 * - Minimum length 3; structure rules for a safe local-part
 */

export const MIN_LOCAL_PART_LENGTH = 3
export const MAX_LOCAL_PART_LENGTH = 64

/**
 * RFC 2142 common mailbox names + closely related operational roles.
 * @see https://www.rfc-editor.org/rfc/rfc2142
 */
const RFC_AND_OPERATIONAL: readonly string[] = [
  // RFC 2142 — BUSINESS
  'info',
  'marketing',
  'sales',
  'support',
  // RFC 2142 — NETWORK
  'abuse',
  'noc',
  'security',
  // RFC 2142 — WEB
  'webmaster',
  'www',
  // RFC 2142 — DNS
  'hostmaster',
  // RFC 2142 — USENET
  'usenet',
  'news',
  // RFC 2142 — FTP
  'ftp',
  // RFC 5321 / traditional
  'postmaster',
  // Common MTA / null routes
  'mailer-daemon',
  'mailer_daemon',
  'mailerdaemon',
  'daemon',
  'uucp',
  'nobody',
  'root',
  // No-reply family
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'do_not_reply',
  // Ops / infra (not all in RFC 2142, but standard practice)
  'admin',
  'administrator',
  'sysadmin',
  'system',
  'sys',
  'mail',
  'email',
  'smtp',
  'imap',
  'pop',
  'pop3',
  'mx',
  'dns',
  'ssl',
  'tls',
  'cert',
  'certs',
  'certificate',
  'acme',
  'api',
  'null',
  'undefined',
  'localhost',
  'localdomain',
  'invalid',
  'example',
  'test',
  'testing',
  'spam',
  'ham',
  'virus',
  'phishing',
  'contact',
  'help',
  'helpdesk',
  'billing',
  'invoice',
  'invoices',
  'payment',
  'payments',
  'privacy',
  'legal',
  'compliance',
  'dmca',
  'copyright',
  'owner',
  'operator',
  'encode',
  'decoder',
  'list',
  'list-request',
  'majordomo',
  'mailman',
  'subscribe',
  'unsubscribe',
  'bounce',
  'bounces',
  'newsletter',
  'notifications',
  'notification',
  'alerts',
  'alert',
  'status',
  'service',
  'services',
  'customerservice',
  'customer-service',
  'cs',
  // Product self-names
  'lemon',
  'lemonmail',
  'lemon-mail',
  'lemonhub',
  'lemon-hub',
]

/**
 * Well-known brands / platforms often abused for phishing via lookalike addresses.
 * Matching is exact on the full local-part or any dot/_/+/- separated token.
 */
const BLOCKED_BRANDS: readonly string[] = [
  // Global tech & cloud
  'google',
  'gmail',
  'youtube',
  'alphabet',
  'android',
  'chrome',
  'apple',
  'icloud',
  'iphone',
  'ipad',
  'macos',
  'microsoft',
  'msft',
  'outlook',
  'hotmail',
  'live',
  'msn',
  'office',
  'office365',
  'o365',
  'azure',
  'windows',
  'xbox',
  'github',
  'gitlab',
  'bitbucket',
  'atlassian',
  'amazon',
  'aws',
  'prime',
  'kindle',
  'ebay',
  'paypal',
  'stripe',
  'square',
  'meta',
  'facebook',
  'fb',
  'instagram',
  'whatsapp',
  'threads',
  'messenger',
  'twitter',
  'tweet',
  'linkedin',
  'tiktok',
  'bytedance',
  'byte-dance',
  'douyin',
  'netflix',
  'spotify',
  'steam',
  'valve',
  'discord',
  'slack',
  'zoom',
  'dropbox',
  'box',
  'adobe',
  'oracle',
  'ibm',
  'intel',
  'nvidia',
  'amd',
  'samsung',
  'huawei',
  'xiaomi',
  'redmi',
  'oppo',
  'vivo',
  'oneplus',
  'sony',
  'nokia',
  'lg',
  'dell',
  'hp',
  'lenovo',
  'cisco',
  'cloudflare',
  'vercel',
  'netlify',
  'heroku',
  'digitalocean',
  'linode',
  'openai',
  'anthropic',
  'chatgpt',
  'claude',
  'gemini',
  'copilot',
  'deepseek',
  'midjourney',
  'stability',
  // China platforms
  'alibaba',
  'alipay',
  'taobao',
  'tmall',
  'aliyun',
  'alibaba-cloud',
  'jd',
  'jingdong',
  'pinduoduo',
  'pdd',
  'baidu',
  'tencent',
  'wechat',
  'weixin',
  'qq',
  'qmail',
  'qqmail',
  'bilibili',
  'bili',
  'meituan',
  'dianping',
  'didi',
  'netease',
  '163',
  '126',
  'yeah',
  'sina',
  'weibo',
  'sohu',
  '360',
  'qihoo',
  'ctrip',
  'trip',
  'fliggy',
  'eleme',
  'ele',
  'kuaishou',
  'xiaohongshu',
  'xhs',
  'zhihu',
  'douban',
  'csdn',
  'juejin',
  // Mail / identity providers
  'proton',
  'protonmail',
  'protonme',
  'zoho',
  'fastmail',
  'gmx',
  'yandex',
  'mailchimp',
  'sendgrid',
  'mailgun',
  'ses',
  'icloudmail',
  // Finance / logistics often spoofed
  'visa',
  'mastercard',
  'amex',
  'americanexpress',
  'unionpay',
  'yinlian',
  'icbc',
  'ccb',
  'abc',
  'boc',
  'bankcomm',
  'hsbc',
  'citibank',
  'citi',
  'chase',
  'wellsfargo',
  'bankofamerica',
  'dhl',
  'fedex',
  'ups',
  'usps',
  'ems',
  'sfexpress',
  'shunfeng',
  'yuantong',
  'yunda',
  'zhongtong',
  'sto',
  'jd-express',
  // Travel / ride
  'uber',
  'lyft',
  'airbnb',
  'booking',
  'expedia',
  'tripadvisor',
]

const RFC_AND_OPERATIONAL_SET = new Set(RFC_AND_OPERATIONAL.map((s) => s.toLowerCase()))
const BLOCKED_BRAND_SET = new Set(BLOCKED_BRANDS.map((s) => s.toLowerCase()))

export type LocalPartErrorCode =
  | 'local_part_required'
  | 'local_part_too_short'
  | 'local_part_too_long'
  | 'local_part_invalid_chars'
  | 'local_part_leading_dot'
  | 'local_part_consecutive_dots'
  | 'local_part_start_end'
  | 'local_part_reserved'
  | 'local_part_brand_blocked'

export type LocalPartResult = { ok: true; value: string } | { ok: false; code: LocalPartErrorCode }

/** Exact match or any separator-token match (e.g. google.support, pay-pal-notify). */
function isBlockedBrandLocalPart(value: string): boolean {
  if (BLOCKED_BRAND_SET.has(value)) return true
  const tokens = value.split(/[._+-]+/).filter(Boolean)
  return tokens.some((t) => BLOCKED_BRAND_SET.has(t))
}

/**
 * Normalize and validate mailbox local-part for registration.
 */
export function normalizeLocalPart(raw: string): LocalPartResult {
  const value = raw.trim().toLowerCase()
  if (!value) return { ok: false, code: 'local_part_required' }
  if (value.length < MIN_LOCAL_PART_LENGTH) {
    return { ok: false, code: 'local_part_too_short' }
  }
  if (value.length > MAX_LOCAL_PART_LENGTH) {
    return { ok: false, code: 'local_part_too_long' }
  }
  if (!/^[a-z0-9._+-]+$/.test(value)) {
    return { ok: false, code: 'local_part_invalid_chars' }
  }
  if (value.startsWith('.') || value.endsWith('.')) {
    return { ok: false, code: 'local_part_leading_dot' }
  }
  if (value.includes('..')) {
    return { ok: false, code: 'local_part_consecutive_dots' }
  }
  if (!/^[a-z0-9]/.test(value) || !/[a-z0-9]$/.test(value)) {
    return { ok: false, code: 'local_part_start_end' }
  }

  // RFC 2142 / operational roles take precedence in messaging
  if (RFC_AND_OPERATIONAL_SET.has(value)) {
    return { ok: false, code: 'local_part_reserved' }
  }

  // Brand names and multi-token spoof attempts
  if (isBlockedBrandLocalPart(value)) {
    return { ok: false, code: 'local_part_brand_blocked' }
  }

  return { ok: true, value }
}
