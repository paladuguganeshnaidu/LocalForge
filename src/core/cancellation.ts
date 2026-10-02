export function withCancellation<Result>(operation: Promise<Result>, signal?: AbortSignal): Promise<Result> {
  if (!signal) return operation;
  return new Promise<Result>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new DOMException('Operation cancelled.', 'AbortError'));
    };
    operation.then(
      (result) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
        else resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
