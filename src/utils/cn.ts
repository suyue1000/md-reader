import clsx, { type ClassValue } from 'clsx';

/** 条件类名拼接，组件层统一使用，避免各处手写模板字符串 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
