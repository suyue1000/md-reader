/**
 * File System Access API 的类型补全。
 *
 * TypeScript 的 lib.dom 目前只声明了 `FileSystemFileHandle` 等接口，
 * 但没有 `showOpenFilePicker` / `showDirectoryPicker` 这两个入口函数，
 * 也没有权限查询方法。这里按 WICG 规范补齐我们实际用到的部分。
 */

/** 文件选择器接受的类型 */
interface FilePickerAcceptType {
  description?: string;
  /** MIME 类型 -> 扩展名列表 */
  accept: Record<string, string[]>;
}

/** 选择器的起始位置：可以是知名目录名，也可以是此前拿到的 handle */
type StartInDirectory =
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos'
  | FileSystemHandle;

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
  /** 同一个 id 会让浏览器记住上次的目录 */
  id?: string;
  startIn?: StartInDirectory;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: StartInDirectory;
}

/** 权限描述符 */
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  /** 查询当前权限状态 */
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  /** 请求权限（需要用户手势） */
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
  id?: string;
  startIn?: StartInDirectory;
}

declare function showOpenFilePicker(
  options?: OpenFilePickerOptions,
): Promise<FileSystemFileHandle[]>;

declare function showDirectoryPicker(
  options?: DirectoryPickerOptions,
): Promise<FileSystemDirectoryHandle>;

declare function showSaveFilePicker(
  options?: SaveFilePickerOptions,
): Promise<FileSystemFileHandle>;

interface Window {
  showOpenFilePicker?: typeof showOpenFilePicker;
  showDirectoryPicker?: typeof showDirectoryPicker;
  showSaveFilePicker?: typeof showSaveFilePicker;
}
