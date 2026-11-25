export type SchedulePickerWait = <T>(read: () => T | undefined | false, label: string) => Promise<T>;

export function scheduleOption(root: ParentNode, selector: string, text: string): HTMLElement | undefined {
  const matches = [...root.querySelectorAll<HTMLElement>(selector)]
    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && element.textContent?.trim() === text);
  return matches.length === 1 ? matches[0] : undefined;
}

/** The workbench accepts dates within seven days, so these calendars can be at most one month away. */
export async function selectScheduleMonth(
  date: string,
  readHeading: () => string,
  move: (direction: 'previous' | 'next') => void,
  wait: SchedulePickerWait,
  platform: string,
): Promise<void> {
  const target = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
  const readMonth = () => {
    const match = readHeading().match(/(\d{4})\s*年\s*(\d{1,2})\s*月/u);
    return match ? Number(match[1]) * 12 + Number(match[2]) : undefined;
  };
  const current = await wait(readMonth, `读取${platform}定时日历月份`);
  if (current === target) return;
  if (Math.abs(current - target) !== 1) throw new Error(`${platform}定时日历月份与目标日期不符，请手动检查`);
  move(target > current ? 'next' : 'previous');
  await wait(() => readMonth() === target, `核验${platform}定时日历月份`);
}
