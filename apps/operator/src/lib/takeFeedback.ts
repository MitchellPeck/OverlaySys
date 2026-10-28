import { useStore } from "./store";

/** How long a take may go unanswered before the UI says it may not have gone out. */
export const TAKE_ECHO_TIMEOUT_MS = 2000;

/**
 * Resolves true once the server echoes a new `channel_state` for `channel`
 * (any change to that channel's state object), or false after `timeoutMs`.
 * Call it right after sending the take. The returned `cancel` stops waiting
 * without resolving (component unmount).
 */
export function awaitChannelEcho(
  channel: string,
  timeoutMs: number = TAKE_ECHO_TIMEOUT_MS,
): { done: Promise<boolean>; cancel: () => void } {
  const initial = useStore.getState().channelStates[channel];
  let unsub = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
  const done = new Promise<boolean>((resolve) => {
    unsub = useStore.subscribe((s) => {
      if (s.channelStates[channel] !== initial) {
        cancel();
        resolve(true);
      }
    });
    timer = setTimeout(() => {
      cancel();
      resolve(false);
    }, timeoutMs);
  });
  return { done, cancel };
}
