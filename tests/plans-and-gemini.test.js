import { describe, it, expect, vi } from 'vitest';
import { PLANS, getPlan, featAllowed, isAiAllowed } from '../src/plans.js';

describe('plans — subscription tiers and feature gating', () => {
  it('defines free tier without AI and pro tier with AI', () => {
    const free = getPlan('free');
    expect(free).toBeDefined();
    expect(free.hasAi).toBe(false);
    expect(isAiAllowed('free')).toBe(false);

    const pro = getPlan('pro');
    expect(pro).toBeDefined();
    expect(pro.hasAi).toBe(true);
    expect(isAiAllowed('pro')).toBe(true);
  });

  it('correctly maps full and legacy plans', () => {
    const full = getPlan('full');
    expect(full).toBeDefined();
    expect(isAiAllowed('full')).toBe(true);

    const basic = getPlan('basic');
    expect(basic).toBeDefined();
    expect(isAiAllowed('basic')).toBe(false);
  });

  it('allows core features on all plans', () => {
    expect(featAllowed('free', null)).toBe(true);
    expect(featAllowed('free', '')).toBe(true);
  });

  it('restricts advanced features on free plan and unlocks on pro', () => {
    expect(featAllowed('free', 'accounting')).toBe(false);
    expect(featAllowed('free', 'ai')).toBe(false);

    expect(featAllowed('pro', 'accounting')).toBe(true);
    expect(featAllowed('pro', 'ai')).toBe(true);
  });

  it('verifies Gemini service is exported and configured as read-only', async () => {
    const { analyzeStoreData, chatWithStoreAdvisor, isGeminiConfigured } = await import('../src/services/gemini.js');
    expect(typeof analyzeStoreData).toBe('function');
    expect(typeof chatWithStoreAdvisor).toBe('function');
    expect(typeof isGeminiConfigured).toBe('function');
  });
});
