import { describe, expect, it } from 'vitest'
import { normalizeLocalPart } from '../shared/local-part'

describe('normalizeLocalPart', () => {
  it('正常前缀：小写化、去空白', () => {
    expect(normalizeLocalPart('  Hello.World ')).toEqual({ ok: true, value: 'hello.world' })
  })

  it('少于 3 个字符拒绝', () => {
    expect(normalizeLocalPart('ab')).toEqual({ ok: false, code: 'local_part_too_short' })
  })

  it('超过 64 字符拒绝', () => {
    expect(normalizeLocalPart('a'.repeat(65))).toEqual({ ok: false, code: 'local_part_too_long' })
  })

  it('非法字符拒绝', () => {
    expect(normalizeLocalPart('bad name!')).toEqual({ ok: false, code: 'local_part_invalid_chars' })
    expect(normalizeLocalPart('中文123')).toEqual({ ok: false, code: 'local_part_invalid_chars' })
  })

  it('点号规则：不能开头/结尾/连续', () => {
    expect(normalizeLocalPart('.lead')).toEqual({ ok: false, code: 'local_part_leading_dot' })
    expect(normalizeLocalPart('trail.')).toEqual({ ok: false, code: 'local_part_leading_dot' })
    expect(normalizeLocalPart('a..b')).toEqual({ ok: false, code: 'local_part_consecutive_dots' })
  })

  it('首尾必须是字母数字', () => {
    expect(normalizeLocalPart('-ab')).toEqual({ ok: false, code: 'local_part_start_end' })
    expect(normalizeLocalPart('ab-')).toEqual({ ok: false, code: 'local_part_start_end' })
    expect(normalizeLocalPart('a-b')).toEqual({ ok: true, value: 'a-b' })
  })

  it('合法复杂前缀通过', () => {
    expect(normalizeLocalPart('user.name+tag')).toEqual({ ok: true, value: 'user.name+tag' })
    expect(normalizeLocalPart('a.b.c-d_e')).toEqual({ ok: true, value: 'a.b.c-d_e' })
  })

  it('RFC/运维保留名拒绝', () => {
    for (const reserved of ['postmaster', 'abuse', 'hostmaster', 'webmaster', 'noreply', 'www']) {
      expect(normalizeLocalPart(reserved)).toEqual({ ok: false, code: 'local_part_reserved' })
    }
  })

  it('品牌前缀拒绝', () => {
    expect(normalizeLocalPart('google')).toEqual({ ok: false, code: 'local_part_brand_blocked' })
    expect(normalizeLocalPart('paypal-notify')).toEqual({ ok: false, code: 'local_part_brand_blocked' })
  })
})
