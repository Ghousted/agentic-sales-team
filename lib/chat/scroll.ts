/** The scroll box fields the chat thread's autoscroll reads. */
export type ScrollBox = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** How close to the bottom (px) still counts as "reading the latest". */
export const NEAR_BOTTOM_PX = 120;

/** Whether the thread is scrolled to (or within a few lines of) the bottom. */
export function isNearBottom(el: ScrollBox, threshold = NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** Whether new content should pull the thread to the bottom: always on a fresh
 *  thread or right after the user's own send, otherwise only when they were
 *  already reading the bottom (so scrolling up through history isn't yanked). */
export function shouldStick(opts: { fresh: boolean; sentByMe: boolean; wasNearBottom: boolean }): boolean {
  return opts.fresh || opts.sentByMe || opts.wasNearBottom;
}
