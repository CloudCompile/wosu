/**
 * Yield to the browser between chunks of long work: `scheduler.yield`
 * where it exists (it keeps task priority and lets input through), else a
 * macrotask, so the work is split across frames instead of running as one
 * long task.
 */
export function nextTask(): Promise<void> {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (s?.yield) return s.yield();
    // A MessageChannel task is a real macrotask (input gets a turn) that,
    // unlike a nested setTimeout, isn't clamped to 4 ms.
    if (typeof MessageChannel === 'function') {
        return new Promise<void>(resolve => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                resolve();
            };
            channel.port2.postMessage(0);
        });
    }
    return new Promise<void>(resolve => setTimeout(resolve, 0));
}
