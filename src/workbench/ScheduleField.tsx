import { scheduleStepMinutes, scheduleWindowMs } from '../core/publication';

const pad = (value: number) => String(value).padStart(2, '0');
const hours = Array.from({length: 24}, (_, index) => pad(index));
const minutes = Array.from({length: 60 / scheduleStepMinutes}, (_, index) => pad(index * scheduleStepMinutes));
const slotMs = scheduleStepMinutes * 60_000;

function localDateTimeValue(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface ScheduleFieldProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
  saved?: boolean;
}

export function ScheduleField({value, disabled, onChange, onSave, saved}: ScheduleFieldProps) {
  const now = Date.now();
  const min = localDateTimeValue((Math.floor(now / slotMs) + 1) * slotMs);
  const max = localDateTimeValue(Math.floor((now + scheduleWindowMs) / slotMs) * slotMs);
  const [day = '', time] = value.split('T');
  const [hour = '', minute = ''] = time?.split(':') ?? [];
  const inRange = (h: string, m: string) => {
    const candidate = `${day}T${h}:${m}`;
    return candidate >= min && candidate <= max;
  };
  const changeHour = (nextHour: string) => {
    const nextMinute = inRange(nextHour, minute) && minutes.includes(minute)
      ? minute
      : minutes.find(m => inRange(nextHour, m));
    if (nextMinute !== undefined) onChange(`${day}T${nextHour}:${nextMinute}`);
  };

  return <fieldset className="schedule-field" disabled={disabled} aria-describedby="schedule-help">
    <legend className="field-label">定时发布时间 <small id="schedule-help">未来 7 天 · 每 5 分钟</small></legend>
    <div className="schedule-controls">
      <label><span className="sr-only">发布日期</span>
        <input type="date" name="scheduleDate" value={day} min={min.slice(0, 10)} max={max.slice(0, 10)}
          onChange={event => {
            const nextDay = event.currentTarget.value;
            onChange(nextDay ? `${nextDay}T${time ?? min.slice(11)}` : '');
          }} />
      </label>
      <label><span className="sr-only">发布小时</span>
        <select name="scheduleHour" value={hour} disabled={!day} onChange={event => changeHour(event.currentTarget.value)}>
          <option value="" disabled>时</option>
          {hours.map(h => <option key={h} value={h} disabled={!minutes.some(m => inRange(h, m))}>{h}</option>)}
        </select>
      </label>
      <label><span className="sr-only">发布分钟</span>
        <select name="scheduleMinute" value={minute} disabled={!day} aria-invalid={!!minute && !minutes.includes(minute)}
          onChange={event => onChange(`${day}T${hour}:${event.currentTarget.value}`)}>
          <option value="" disabled>分</option>
          {!!minute && !minutes.includes(minute) && <option value={minute} disabled>{minute}（旧值）</option>}
          {minutes.map(m => <option key={m} value={m} disabled={!inRange(hour, m)}>{m}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => onChange('')} disabled={!value} aria-label="清除定时发布时间">清除</button>
    </div>
    {onSave && <div className="schedule-save">
      <button type="button" onClick={onSave} disabled={saved}>保存定时</button>
      <small className="hint" role="status">{saved ? '重新打开平台时使用此时间' : '时间已修改，保存后可重新打开平台'}</small>
    </div>}
  </fieldset>;
}
