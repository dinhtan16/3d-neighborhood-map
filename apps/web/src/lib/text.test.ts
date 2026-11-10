import { describe, expect, it } from 'vitest';
import { foldText } from './text';
import { isCategoryVisible } from '@/features/map/store';

describe('foldText', () => {
  it('strips Vietnamese diacritics like f_unaccent(lower())', () => {
    expect(foldText('Chơn Thành')).toBe('chon thanh');
    expect(foldText('Đường Nguyễn Huệ')).toBe('duong nguyen hue');
    expect(foldText('Cà phê BiBo9999')).toContain('ca phe');
  });
});

describe('category filter', () => {
  it('shows everything by default', () => {
    expect(isCategoryVisible([], 'grocery')).toBe(true);
  });
  it('supports "only" mode', () => {
    expect(isCategoryVisible(['__only__', 'grocery'], 'grocery')).toBe(true);
    expect(isCategoryVisible(['__only__', 'grocery'], 'retail')).toBe(false);
  });
  it('treats missing category as "other"', () => {
    expect(isCategoryVisible(['other'], null)).toBe(false);
  });
});
