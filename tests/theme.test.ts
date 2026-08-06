// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { resolveTheme, applyTheme, toggleTheme, initTheme, currentTheme } from '../src/theme'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    delete (globalThis as Record<string, unknown>)['__lmThemeTest']
  })

  it('无存储时跟随系统（浅色 matchMedia stub）', () => {
    expect(resolveTheme()).toBe('light')
  })

  it('applyTheme 写入 class 与 localStorage', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('lm-theme')).toBe('dark')
    expect(currentTheme.value).toBe('dark')
    applyTheme('light', false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('lm-theme')).toBe('dark')
  })

  it('resolveTheme 优先读取已存偏好', () => {
    localStorage.setItem('lm-theme', 'dark')
    expect(resolveTheme()).toBe('dark')
    localStorage.setItem('lm-theme', 'light')
    expect(resolveTheme()).toBe('light')
  })

  it('toggleTheme 在明暗间切换并持久化', () => {
    applyTheme('light')
    const next = toggleTheme()
    expect(next).toBe('dark')
    expect(localStorage.getItem('lm-theme')).toBe('dark')
    expect(toggleTheme()).toBe('light')
  })

  it('initTheme 不持久化', () => {
    localStorage.setItem('lm-theme', 'dark')
    initTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('lm-theme')).toBe('dark')
    localStorage.clear()
    initTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('lm-theme')).toBeNull()
  })
})
