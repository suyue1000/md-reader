import { IS_DEV } from './env';

/**
 * 极简日志器。
 *
 * 生产构建下只保留 warn / error，debug 与 info 被裁掉，
 * 避免在用户控制台里刷屏，也便于后续接入统一错误上报。
 */
type LogArgs = readonly unknown[];

/** 创建带命名空间的 logger */
export function createLogger(namespace: string): {
  debug: (...args: LogArgs) => void;
  info: (...args: LogArgs) => void;
  warn: (...args: LogArgs) => void;
  error: (...args: LogArgs) => void;
} {
  const prefix = `[md-reader:${namespace}]`;
  return {
    debug: (...args: LogArgs) => {
      // eslint-disable-next-line no-console -- 仅开发构建保留，生产构建下不会执行
      if (IS_DEV) console.debug(prefix, ...args);
    },
    info: (...args: LogArgs) => {
      // eslint-disable-next-line no-console -- 同上
      if (IS_DEV) console.info(prefix, ...args);
    },
    warn: (...args: LogArgs) => console.warn(prefix, ...args),
    error: (...args: LogArgs) => console.error(prefix, ...args),
  };
}
