/**
 * 通过隐藏 <a> 标签触发下载，绕过浏览器弹窗拦截。
 * window.open 在异步回调中会被浏览器拦截，<a>.click() 不会。
 */
export function triggerDownload(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  if (filename) {
    a.download = filename;
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
