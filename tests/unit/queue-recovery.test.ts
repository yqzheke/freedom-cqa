import { afterEach, expect, it, vi } from "vitest";
import { recoverQueueState } from "../../lib/queue-recovery";
afterEach(()=>vi.useRealTimers());
it("retries state reads after transient errors then stops after success",async()=>{
vi.useFakeTimers();const refresh=vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue(undefined),report=vi.fn();
const stop=recoverQueueState(refresh,report);await vi.advanceTimersByTimeAsync(2500);expect(refresh).toHaveBeenCalledTimes(1);expect(report).toHaveBeenCalledTimes(1);
await vi.advanceTimersByTimeAsync(2500);expect(refresh).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(10000);expect(refresh).toHaveBeenCalledTimes(2);stop();
});
it("cancels pending recovery on effect cleanup",async()=>{
vi.useFakeTimers();const refresh=vi.fn();const stop=recoverQueueState(refresh,vi.fn());stop();await vi.advanceTimersByTimeAsync(10000);expect(refresh).not.toHaveBeenCalled();
});
it("does not reschedule after an in-flight read fails following cleanup",async()=>{
vi.useFakeTimers();let reject!:(e:Error)=>void;const refresh=vi.fn(()=>new Promise<void>((_,r)=>{reject=r;})),report=vi.fn();const stop=recoverQueueState(refresh,report);await vi.advanceTimersByTimeAsync(2500);stop();reject(Error("offline"));await vi.advanceTimersByTimeAsync(10000);expect(refresh).toHaveBeenCalledTimes(1);expect(report).not.toHaveBeenCalled();
});
