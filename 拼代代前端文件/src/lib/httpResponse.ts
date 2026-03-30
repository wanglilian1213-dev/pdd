export async function parseApiResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!isJson) {
    throw new Error(res.ok ? fallbackMessage : '服务器暂时返回了异常内容，请稍后再试。');
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error('服务器返回的数据格式异常，请稍后再试。');
  }

  if (!res.ok || !json?.success) {
    throw new Error(json?.error || fallbackMessage);
  }

  return json.data as T;
}
